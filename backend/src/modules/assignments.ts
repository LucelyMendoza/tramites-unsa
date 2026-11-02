import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { AWAY_SQL, OPEN_STATUSES, resolveAssignee, setAssignee, type StaffLite } from '../domain/assignment.js';
import { badRequest, notFound } from '../errors.js';
import { audit, requireStaff } from './service.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Gestión de responsables (solo superadministrador):
 * - Reglas: tipo de trámite → responsable. Se aplican al enviar la solicitud.
 * - Ausencias: rango de fechas + suplente. Durante la ausencia lo nuevo va al suplente.
 * - Reasignación masiva de las solicitudes abiertas de una persona.
 */
export const assignmentRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const { db, cfg } = deps;

  async function staffOr400(id: string): Promise<StaffLite & { scope: string[] | null }> {
    const s = (await db.query<any>(`SELECT u.id,u.email,u.display_name,s.faculty_scope FROM staff_roles s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.active`, [id]))[0];
    if (!s) throw badRequest('La persona indicada no es personal administrativo activo');
    return { id: s.id, email: s.email, name: s.display_name, scope: s.faculty_scope };
  }

  /** Mueve las solicitudes abiertas de `fromId` a `toId` (o a su suplente efectivo); sin alcance → bandeja general. */
  async function moveOpen(actor: { id: string; email: string }, fromId: string, toId: string | null) {
    return db.tx(async (q) => {
      const rows = await q.query<any>(
        `SELECT id,code,apellidos_nombres,tramite_type_id,faculty_id FROM requests WHERE assigned_to=$1 AND status = ANY($2::text[]) FOR UPDATE`,
        [fromId, OPEN_STATUSES],
      );
      let moved = 0, unassigned = 0;
      for (const r of rows) {
        const eff = toId ? await resolveAssignee(q, toId, r.faculty_id) : null;
        await setAssignee(q, cfg, r, eff, { actorId: actor.id, actorEmail: actor.email, why: 'reasignacion_masiva', from: fromId });
        eff ? moved++ : unassigned++;
      }
      return { total: rows.length, moved, unassigned };
    });
  }

  // ---------- Reglas por tipo de trámite ----------
  app.get('/api/admin/assignment-rules', async (req) => {
    requireStaff(req.user!, 'assignment:manage');
    const rows = await db.query<any>(
      `SELECT t.id,t.code,t.name,t.group_label,t.sort_order,r.assignee_id,u.email,u.display_name
         FROM tramite_types t LEFT JOIN assignment_rules r ON r.tramite_type_id=t.id LEFT JOIN users u ON u.id=r.assignee_id
        WHERE t.active ORDER BY t.sort_order,t.name`,
    );
    return rows.map((r) => ({
      tramiteTypeId: r.id, code: r.code, name: r.name, group: r.group_label,
      assignee: r.assignee_id ? { id: r.assignee_id, email: r.email, name: r.display_name } : null,
    }));
  });

  app.put('/api/admin/assignment-rules/:tramiteTypeId', async (req) => {
    const user = req.user!;
    requireStaff(user, 'assignment:manage');
    const tramiteTypeId = uuid.parse((req.params as any).tramiteTypeId);
    const b = z.object({ assigneeId: uuid.nullable(), reassignUnassigned: z.boolean().default(false) }).strict().parse(req.body);
    const t = (await db.query<any>(`SELECT id FROM tramite_types WHERE id=$1`, [tramiteTypeId]))[0];
    if (!t) throw notFound('Tipo de trámite no encontrado');
    if (b.assigneeId) {
      await staffOr400(b.assigneeId);
      await db.query(
        `INSERT INTO assignment_rules(tramite_type_id,assignee_id,updated_by) VALUES ($1,$2,$3)
         ON CONFLICT (tramite_type_id) DO UPDATE SET assignee_id=EXCLUDED.assignee_id, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [tramiteTypeId, b.assigneeId, user.id],
      );
    } else await db.query(`DELETE FROM assignment_rules WHERE tramite_type_id=$1`, [tramiteTypeId]);
    await audit(db, user, 'assignment.rule', 'tramite_type', tramiteTypeId, { assigneeId: b.assigneeId }, req.ip);
    // Opcional: aplicar la regla a las solicitudes abiertas de ese tipo que hoy no tienen responsable.
    let applied = 0;
    if (b.assigneeId && b.reassignUnassigned) {
      applied = await db.tx(async (q) => {
        const rows = await q.query<any>(
          `SELECT id,code,apellidos_nombres,tramite_type_id,faculty_id FROM requests WHERE tramite_type_id=$1 AND assigned_to IS NULL AND status = ANY($2::text[]) FOR UPDATE`,
          [tramiteTypeId, OPEN_STATUSES],
        );
        let n = 0;
        for (const r of rows) {
          const eff = await resolveAssignee(q, b.assigneeId, r.faculty_id);
          if (eff) { await setAssignee(q, cfg, r, eff, { actorId: user.id, actorEmail: user.email, why: 'regla' }); n++; }
        }
        return n;
      });
    }
    return { ok: true, applied };
  });

  // ---------- Personal: disponibilidad y carga ----------
  app.get('/api/admin/availability', async (req) => {
    requireStaff(req.user!, 'assignment:manage');
    const rows = await db.query<any>(
      `SELECT u.id,u.email,u.display_name,s.role,s.faculty_scope,s.away_from,s.away_until,s.away_note,s.substitute_id,
              su.email AS substitute_email, su.display_name AS substitute_name, ${AWAY_SQL} AS away_now,
              (SELECT count(*)::int FROM requests r WHERE r.assigned_to=u.id AND r.status = ANY($1::text[])) AS open_count,
              (SELECT count(*)::int FROM assignment_rules ar WHERE ar.assignee_id=u.id) AS rules_count
         FROM staff_roles s JOIN users u ON u.id=s.user_id LEFT JOIN users su ON su.id=s.substitute_id
        WHERE s.active ORDER BY u.display_name, u.email`,
      [OPEN_STATUSES],
    );
    const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : null);
    return rows.map((r) => ({
      id: r.id, email: r.email, name: r.display_name, role: r.role, scope: r.faculty_scope,
      absence: r.away_from ? { from: d(r.away_from), until: d(r.away_until), note: r.away_note, active: !!r.away_now,
        substitute: r.substitute_id ? { id: r.substitute_id, email: r.substitute_email, name: r.substitute_name } : null } : null,
      openCount: r.open_count, rulesCount: r.rules_count,
    }));
  });

  app.put('/api/admin/availability/:userId/absence', async (req) => {
    const user = req.user!;
    requireStaff(user, 'assignment:manage');
    const userId = uuid.parse((req.params as any).userId);
    const b = z.object({
      from: isoDate, until: isoDate, substituteId: uuid.nullable(), note: z.string().max(200).optional(),
      reassignOpen: z.boolean().default(true),
    }).strict().parse(req.body);
    await staffOr400(userId);
    if (b.until < b.from) throw badRequest('La fecha de retorno no puede ser anterior al inicio de la ausencia');
    if (b.substituteId) {
      if (b.substituteId === userId) throw badRequest('El suplente debe ser otra persona');
      await staffOr400(b.substituteId);
    }
    await db.query(`UPDATE staff_roles SET away_from=$2,away_until=$3,substitute_id=$4,away_note=$5 WHERE user_id=$1`,
      [userId, b.from, b.until, b.substituteId, b.note ?? null]);
    await audit(db, user, 'staff.absence_set', 'user', userId, { from: b.from, until: b.until, substituteId: b.substituteId }, req.ip);
    // Lo ya asignado no debe quedarse esperando: se pasa al suplente (o a la bandeja general).
    const startsToday = b.from <= new Date().toISOString().slice(0, 10);
    const moved = b.reassignOpen && startsToday ? await moveOpen(user, userId, b.substituteId) : { total: 0, moved: 0, unassigned: 0 };
    return { ok: true, startsToday, ...moved };
  });

  app.delete('/api/admin/availability/:userId/absence', async (req) => {
    const user = req.user!;
    requireStaff(user, 'assignment:manage');
    const userId = uuid.parse((req.params as any).userId);
    await db.query(`UPDATE staff_roles SET away_from=NULL,away_until=NULL,substitute_id=NULL,away_note=NULL WHERE user_id=$1`, [userId]);
    await audit(db, user, 'staff.absence_clear', 'user', userId, {}, req.ip);
    return { ok: true };
  });

  app.post('/api/admin/availability/:userId/reassign', async (req) => {
    const user = req.user!;
    requireStaff(user, 'assignment:manage');
    const userId = uuid.parse((req.params as any).userId);
    const b = z.object({ toUserId: uuid.nullable() }).strict().parse(req.body);
    if (b.toUserId === userId) throw badRequest('Elija a otra persona');
    if (b.toUserId) await staffOr400(b.toUserId);
    const r = await moveOpen(user, userId, b.toUserId);
    await audit(db, user, 'staff.reassign_open', 'user', userId, { toUserId: b.toUserId, ...r }, req.ip);
    return { ok: true, ...r };
  });
};
