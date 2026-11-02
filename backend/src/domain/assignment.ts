import type { Config } from '../config.js';
import type { Queryable } from '../db/index.js';
import { enqueue } from '../notifications/outbox.js';

/** Estados en los que una solicitud sigue "en la bandeja" de alguien (no borrador ni cerrada). */
export const OPEN_STATUSES = ['ENVIADA', 'EN_REVISION', 'REQUIERE_SUBSANACION', 'REENVIADA', 'EN_TRAMITE', 'EMITIDA'];

export interface StaffLite { id: string; email: string; name: string }

/** Expresión SQL: el miembro del personal está ausente HOY (fecha del servidor). */
export const AWAY_SQL = `(s.away_from IS NOT NULL AND CURRENT_DATE >= s.away_from AND CURRENT_DATE <= COALESCE(s.away_until, 'infinity'::date))`;

/**
 * Responsable efectivo para una facultad: si el titular está ausente se sigue la cadena de suplentes
 * (máx. 4 saltos, sin ciclos). Devuelve null si nadie disponible tiene alcance: la solicitud queda en
 * la bandeja general sin asignar, a la vista de todo el personal con alcance.
 */
export async function resolveAssignee(q: Queryable, preferredId: string | null, facultyId: string): Promise<StaffLite | null> {
  const seen = new Set<string>();
  let cur = preferredId;
  for (let hop = 0; cur && hop < 5 && !seen.has(cur); hop++) {
    seen.add(cur);
    const s = (
      await q.query<any>(
        `SELECT u.id,u.email,u.display_name,s.active,s.faculty_scope,s.substitute_id,${AWAY_SQL} AS away
           FROM staff_roles s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1`,
        [cur],
      )
    )[0];
    if (!s || !s.active) return null;
    if (s.away) { cur = s.substitute_id; continue; }
    if (s.faculty_scope && !s.faculty_scope.includes(facultyId)) return null;
    return { id: s.id, email: s.email, name: s.display_name };
  }
  return null;
}

/** Asigna (o desasigna) una solicitud, deja auditoría y avisa por correo al nuevo responsable. */
export async function setAssignee(
  q: Queryable,
  cfg: Pick<Config, 'APP_URL'>,
  req: { id: string; code: string | null; apellidos_nombres: string; tramite_type_id: string },
  to: StaffLite | null,
  meta: { actorId: string | null; actorEmail: string | null; why: 'regla' | 'ausencia' | 'manual' | 'reasignacion_masiva'; from?: string | null },
) {
  await q.query(`UPDATE requests SET assigned_to=$2, updated_at=now() WHERE id=$1`, [req.id, to?.id ?? null]);
  await q.query(
    `INSERT INTO audit_log(actor_id,actor_email,action,entity,entity_id,meta) VALUES ($1,$2,'request.assign','request',$3,$4::jsonb)`,
    [meta.actorId, meta.actorEmail, req.id, JSON.stringify({ assignedTo: to?.id ?? null, why: meta.why, from: meta.from ?? null })],
  );
  if (to) {
    const type = (await q.query<any>(`SELECT name FROM tramite_types WHERE id=$1`, [req.tramite_type_id]))[0];
    await enqueue(q, {
      requestId: req.id,
      userId: to.id,
      toEmail: to.email,
      event: 'ASIGNADA',
      dedupeSuffix: `${to.id}:${Date.now()}`,
      payload: {
        code: req.code ?? undefined,
        name: to.name || undefined,
        tramite: type?.name,
        reason: meta.why === 'ausencia' || meta.why === 'reasignacion_masiva' ? 'Reasignada por ausencia del responsable titular.' : undefined,
        link: `${cfg.APP_URL}/admin/solicitud/${req.id}`,
      },
    });
  }
}

/**
 * Al llegar una solicitud a la bandeja del personal (ENVIADA o REENVIADA):
 * - sin responsable → se aplica la regla del tipo de trámite;
 * - con responsable ausente → pasa a su suplente (no se acumula en quien está de vacaciones).
 */
export async function routeOnArrival(q: Queryable, cfg: Pick<Config, 'APP_URL'>, requestId: string) {
  const r = (await q.query<any>(`SELECT id,code,apellidos_nombres,tramite_type_id,faculty_id,assigned_to FROM requests WHERE id=$1`, [requestId]))[0];
  if (!r) return;
  if (r.assigned_to) {
    const eff = await resolveAssignee(q, r.assigned_to, r.faculty_id);
    if (eff && eff.id !== r.assigned_to) await setAssignee(q, cfg, r, eff, { actorId: null, actorEmail: 'sistema', why: 'ausencia', from: r.assigned_to });
    return;
  }
  const rule = (await q.query<any>(`SELECT assignee_id FROM assignment_rules WHERE tramite_type_id=$1`, [r.tramite_type_id]))[0];
  if (!rule) return;
  const eff = await resolveAssignee(q, rule.assignee_id, r.faculty_id);
  if (eff) await setAssignee(q, cfg, r, eff, { actorId: null, actorEmail: 'sistema', why: eff.id === rule.assignee_id ? 'regla' : 'ausencia', from: null });
}
