import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { AWAY_SQL, setAssignee } from '../domain/assignment.js';
import { finalizeUnmet, receiptState } from '../domain/receipt.js';
import { enqueue } from '../notifications/outbox.js';

import { can } from '../domain/permissions.js';
import { STATUSES } from '../domain/stateMachine.js';
import { parseConfig, tramiteConfigSchema } from '../domain/tramiteConfig.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { MIME_BY_KIND, verifyContent } from '../storage/fileSniff.js';
import { newObjectKey } from '../storage/index.js';
import {
  applyTransition,
  assertScope,
  audit,
  getType,
  labelTargets,
  loadDetail,
  lockRequest,
  requireStaff,
  validateTargets,
  type AuthUser,
} from './service.js';

const uuid = z.string().uuid();

const filterSchema = z.object({
  status: z.enum(STATUSES).optional(),
  facultyId: uuid.optional(),
  schoolId: uuid.optional(),
  programId: uuid.optional(),
  tramiteTypeId: uuid.optional(),
  assignedTo: uuid.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(100).optional(),
});
type Filters = z.infer<typeof filterSchema>;

function buildWhere(user: AuthUser, f: Filters) {
  const where: string[] = [`r.status <> 'BORRADOR'`];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  // Alcance por facultad del administrador (siempre en el servidor).
  const scope = user.staff!.scope;
  if (scope) add('r.faculty_id = ANY(?::uuid[])', scope);
  if (f.status) add('r.status = ?', f.status);
  if (f.facultyId) add('r.faculty_id = ?', f.facultyId);
  if (f.schoolId) add('r.school_id = ?', f.schoolId);
  if (f.tramiteTypeId) add('r.tramite_type_id = ?', f.tramiteTypeId);
  if (f.assignedTo) add('r.assigned_to = ?', f.assignedTo);
  if (f.from) add('r.submitted_at >= ?::date', f.from);
  if (f.to) add(`r.submitted_at < (?::date + interval '1 day')`, f.to);
  if (f.q) {
    const q = f.q.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    if (/^\d+$/.test(q)) {
      params.push(q, like);
      where.push(`(r.dni = $${params.length - 1} OR r.cui = $${params.length - 1} OR r.code ILIKE $${params.length})`);
    } else {
      params.push(like);
      where.push(`(r.code ILIKE $${params.length} OR r.apellidos_nombres ILIKE $${params.length})`);
    }
    // Número de boleta: coincidencia exacta sobre la forma normalizada (B001-000123 = b001000123).
    const norm = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (norm.length >= 4) {
      params.push(norm);
      where[where.length - 1] = `(${where[where.length - 1]} OR r.receipt_norm = $${params.length})`;
    }
  }
  return { sql: where.join(' AND '), params };
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  return `"${s.replace(/"/g, '""')}"`;
};

export const adminRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const { cfg, db, storage } = deps;

  /** Emitir/finalizar: rol emisor o superadmin, o el revisor que es RESPONSABLE ASIGNADO de la solicitud. */
  const mayIssue = (user: AuthUser, r: any, perm: 'request:issue' | 'request:finalize') =>
    can(user.staff!.role, perm) || (user.staff!.role === 'reviewer' && r.assigned_to === user.id);
  const requireIssue = (user: AuthUser, r: any, perm: 'request:issue' | 'request:finalize' = 'request:issue') => {
    if (!mayIssue(user, r, perm)) throw forbidden('Su rol no permite emitir ni finalizar documentos');
  };

  async function loadScoped(user: AuthUser, id: string) {
    const r = (await db.query<any>(`SELECT * FROM requests WHERE id=$1 AND status <> 'BORRADOR'`, [id]))[0];
    if (!r) throw notFound('Solicitud no encontrada');
    assertScope(user, r.faculty_id);
    return r;
  }

  // ---------- Dashboard ----------
  app.get('/api/admin/stats', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const f = filterSchema.pick({ from: true, to: true, facultyId: true, schoolId: true, programId: true, tramiteTypeId: true }).parse(req.query);
    const w = buildWhere(user, f);
    const row = (
      await db.query<any>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE r.status='ENVIADA')::int AS nuevas,
                count(*) FILTER (WHERE r.status IN ('ENVIADA','REENVIADA','EN_REVISION'))::int AS pendientes_revision,
                count(*) FILTER (WHERE r.status='REQUIERE_SUBSANACION')::int AS requieren_subsanacion,
                count(*) FILTER (WHERE r.status='REENVIADA')::int AS reenviadas,
                count(*) FILTER (WHERE r.status='EN_TRAMITE')::int AS en_tramite,
                count(*) FILTER (WHERE r.status='FINALIZADA')::int AS finalizados,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM issued_documents d WHERE d.request_id=r.id AND d.status='verified'))::int AS documentos_emitidos
           FROM requests r WHERE ${w.sql}`,
        w.params,
      )
    )[0];
    return {
      total: row.total,
      nuevas: row.nuevas,
      pendientesRevision: row.pendientes_revision,
      requierenSubsanacion: row.requieren_subsanacion,
      reenviadas: row.reenviadas,
      enTramite: row.en_tramite,
      documentosEmitidos: row.documentos_emitidos,
      finalizados: row.finalizados,
    };
  });

  // ---------- Listado paginado en el servidor ----------
  app.get('/api/admin/requests', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const p = z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20) });
    const query = req.query as Record<string, string>;
    const { page, pageSize } = p.parse(query);
    const f = filterSchema.parse(query);
    const w = buildWhere(user, f);
    const total = (await db.query<any>(`SELECT count(*)::int AS n FROM requests r WHERE ${w.sql}`, w.params))[0].n;
    const rows = await db.query<any>(
      `SELECT r.id,r.code,r.status,r.apellidos_nombres,r.dni,r.cui,r.submitted_at,r.updated_at,r.resubmit_count,
              f.name AS faculty_name,s.name AS school_name,p.name AS program_name,t.name AS tramite_name,a.email AS assigned_email
         FROM requests r JOIN faculties f ON f.id=r.faculty_id JOIN schools s ON s.id=r.school_id
         LEFT JOIN programs p ON p.id=r.program_id JOIN tramite_types t ON t.id=r.tramite_type_id LEFT JOIN users a ON a.id=r.assigned_to
        WHERE ${w.sql} ORDER BY r.submitted_at DESC, r.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      w.params,
    );
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        apellidosNombres: r.apellidos_nombres,
        dni: r.dni,
        cui: r.cui,
        facultyName: r.faculty_name,
        schoolName: r.school_name,
        programName: r.program_name,
        tramiteName: r.tramite_name,
        submittedAt: r.submitted_at,
        updatedAt: r.updated_at,
        resubmitCount: r.resubmit_count,
        assignedEmail: r.assigned_email,
      })),
    };
  });

  // ---------- Exportación CSV (sin DNI/CUI/nombre) ----------
  app.get('/api/admin/requests/export.csv', async (req, reply) => {
    const user = req.user!;
    requireStaff(user, 'report:export');
    const f = filterSchema.parse(req.query);
    const w = buildWhere(user, f);
    const rows = await db.query<any>(
      `SELECT r.code,t.name AS tramite,f.name AS facultad,s.name AS escuela,r.applicant_type,r.status,
              to_char(r.submitted_at,'YYYY-MM-DD HH24:MI') AS enviada, COALESCE(to_char(r.finalized_at,'YYYY-MM-DD HH24:MI'),'') AS finalizada, r.resubmit_count
         FROM requests r JOIN faculties f ON f.id=r.faculty_id JOIN schools s ON s.id=r.school_id
         LEFT JOIN programs p ON p.id=r.program_id JOIN tramite_types t ON t.id=r.tramite_type_id
        WHERE ${w.sql} ORDER BY r.submitted_at DESC LIMIT 20000`,
      w.params,
    );
    await audit(db, user, 'report.export', 'report', null, { rows: rows.length, filters: f }, req.ip);
    const header = ['codigo', 'tramite', 'facultad', 'escuela', 'tipo_solicitante', 'estado', 'fecha_envio', 'fecha_finalizacion', 'reenvios'];
    const lines = [header.join(',')].concat(
      rows.map((r) => [r.code, r.tramite, r.facultad, r.escuela, r.applicant_type, r.status, r.enviada, r.finalizada, r.resubmit_count].map(csvCell).join(',')),
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="solicitudes.csv"')
      .send('﻿' + lines.join('\r\n'));
  });

  // ---------- Detalle ----------
  app.get('/api/admin/requests/:id', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    const r = await loadScoped(user, id);
    const d = await loadDetail(db, id, 'staff', user.id);
    await audit(db, user, 'request.view', 'request', id, {}, req.ip);
    const role = user.staff!.role;
    return {
      ...d,
      can: {
        review: can(role, 'request:review'),
        assign: can(role, 'request:assign'),
        issue: mayIssue(user, r, 'request:issue'),
        finalize: mayIssue(user, r, 'request:finalize'),
        verifyDeclaration: can(role, 'declaration:verify'),
      },
      facultyIdForScope: r.faculty_id,
    };
  });

  // ---------- Revisión: iniciar, solicitar subsanación, aprobar ----------
  const reviewBody = z.discriminatedUnion('action', [
    z.object({ action: z.literal('start_review') }),
    z.object({
      action: z.literal('request_correction'),
      reason: z.string().min(10, 'Describa el motivo (mínimo 10 caracteres)').max(2000),
      targets: z.array(z.object({ type: z.enum(['file', 'field']), key: z.string() })).max(20).default([]),
    }),
    z.object({ action: z.literal('approve'), note: z.string().max(1000).optional() }),
  ]);

  app.post('/api/admin/requests/:id/review', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:review');
    const id = uuid.parse((req.params as any).id);
    const b = reviewBody.parse(req.body);
    await loadScoped(user, id);
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      const { config } = await getType(q, r.tramite_type_id);
      if (b.action === 'start_review') {
        await applyTransition(q, { request: r, to: 'EN_REVISION', actorKind: 'review', actor: user, cfg });
        return { status: 'EN_REVISION' };
      }
      if (b.action === 'approve') {
        if (config.requiresDeclaration) {
          const d = (await q.query<any>(`SELECT 1 FROM declarations WHERE request_id=$1`, [id]))[0];
          if (!d) throw unprocessable('Falta la declaración jurada del solicitante');
        }
        await applyTransition(q, { request: r, to: 'EN_TRAMITE', actorKind: 'review', actor: user, reason: b.note, cfg });
        return { status: 'EN_TRAMITE' };
      }
      const targets = validateTargets(b.targets, config);
      await applyTransition(q, {
        request: r,
        to: 'REQUIERE_SUBSANACION',
        actorKind: 'review',
        actor: user,
        reason: b.reason,
        cfg,
        payloadExtra: { reason: b.reason, targets: labelTargets(targets, config) },
      });
      await q.query(`UPDATE observations SET resolved_at=now() WHERE request_id=$1 AND kind='subsanacion' AND resolved_at IS NULL`, [id]);
      await q.query(`INSERT INTO observations(request_id,author_id,kind,reason,targets) VALUES ($1,$2,'subsanacion',$3,$4::jsonb)`, [id, user.id, b.reason, JSON.stringify(targets)]);
      await q.query(`UPDATE requests SET edited_fields='[]'::jsonb WHERE id=$1`, [id]);
      return { status: 'REQUIERE_SUBSANACION' };
    });
  });

  // ---------- Nota interna (no visible al solicitante) ----------
  app.post('/api/admin/requests/:id/notes', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:review');
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    await loadScoped(user, id);
    await db.query(`INSERT INTO observations(request_id,author_id,kind,reason) VALUES ($1,$2,'nota',$3)`, [id, user.id, b.reason]);
    await audit(db, user, 'request.note', 'request', id, {}, req.ip);
    return { ok: true };
  });

  // ---------- Asignar responsable ----------
  app.post('/api/admin/requests/:id/assign', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:assign');
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ userId: uuid.nullable() }).parse(req.body);
    const r = await loadScoped(user, id);
    if (b.userId) {
      const s = (await db.query<any>(`SELECT faculty_scope,active FROM staff_roles WHERE user_id=$1`, [b.userId]))[0];
      if (!s || !s.active) throw badRequest('El responsable debe ser personal administrativo activo');
      if (s.faculty_scope && !s.faculty_scope.includes(r.faculty_id)) throw badRequest('El responsable no tiene alcance sobre esta facultad');
    }
    const to = b.userId ? (await db.query<any>(`SELECT id,email,display_name AS name FROM users WHERE id=$1`, [b.userId]))[0] : null;
    await setAssignee(db, cfg, r, to, { actorId: user.id, actorEmail: user.email, why: 'manual', from: r.assigned_to ?? null });
    return { ok: true };
  });

  app.get('/api/admin/assignees', async (req) => {
    requireStaff(req.user!, 'request:view');
    const rows = await db.query<any>(`SELECT u.id,u.email,u.display_name,s.role,s.away_until,${AWAY_SQL} AS away FROM staff_roles s JOIN users u ON u.id=s.user_id WHERE s.active ORDER BY u.email`);
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.display_name, role: r.role, away: !!r.away, awayUntil: r.away_until ? new Date(r.away_until).toISOString().slice(0, 10) : null }));
  });

  // ---------- Declaración jurada: verificación institucional posterior ----------
  app.post('/api/admin/requests/:id/declaration/verify', async (req) => {
    const user = req.user!;
    requireStaff(user, 'declaration:verify');
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ status: z.enum(['verificada', 'rechazada']), note: z.string().max(1000).optional() }).parse(req.body);
    await loadScoped(user, id);
    const r = await db.query<any>(
      `UPDATE declarations SET verification_status=$2, verified_by=$3, verified_at=now(), verification_note=$4 WHERE request_id=$1 RETURNING id`,
      [id, b.status, user.id, b.note ?? null],
    );
    if (!r[0]) throw notFound('La solicitud no tiene declaración jurada');
    await audit(db, user, 'declaration.verify', 'request', id, { status: b.status }, req.ip);
    return { ok: true };
  });

  // ---------- Documento emitido: autorizar carga / confirmar ----------
  app.post('/api/admin/requests/:id/issued/presign', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ filename: z.string().min(1).max(200), size: z.number().int().positive() }).parse(req.body);
    const r = await loadScoped(user, id);
    requireIssue(user, r);
    if (!['EN_TRAMITE', 'EMITIDA'].includes(r.status)) throw conflict('Solo se puede cargar el documento emitido cuando la solicitud está En trámite o Emitida');
    if (!b.filename.toLowerCase().endsWith('.pdf')) throw unprocessable('El documento emitido debe ser PDF');
    const max = cfg.MAX_FILE_MB * 1024 * 1024;
    if (b.size > max) throw unprocessable(`Máximo ${cfg.MAX_FILE_MB} MB`);
    const key = newObjectKey('iss');
    const row = (
      await db.query<any>(
        `INSERT INTO issued_documents(request_id,version,object_key,original_name,content_type,size_bytes,status,issued_by)
         VALUES ($1,0,$2,$3,'application/pdf',$4,'pending',$5) RETURNING id`,
        [id, key, b.filename.replace(/[\r\n"\\/]/g, '_'), b.size, user.id],
      )
    )[0];
    const upload = await storage.signUpload(key, 'application/pdf', b.size, cfg.PRESIGN_UPLOAD_TTL_SECONDS);
    await audit(db, user, 'issued.presign_upload', 'request', id, { docId: row.id }, req.ip);
    return { docId: row.id, upload };
  });

  app.post('/api/admin/requests/:id/issued/:docId/complete', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    const docId = uuid.parse((req.params as any).docId);
    requireIssue(user, await loadScoped(user, id));
    const d = (await db.query<any>(`SELECT * FROM issued_documents WHERE id=$1 AND request_id=$2 AND issued_by=$3`, [docId, id, user.id]))[0];
    if (!d) throw notFound();
    if (d.status !== 'pending') throw conflict('Documento ya procesado');
    const max = cfg.MAX_FILE_MB * 1024 * 1024;
    const head = await storage.head(d.object_key);
    if (!head) throw conflict('El archivo todavía no se subió');
    const fail = async (m: string) => {
      await storage.delete(d.object_key).catch(() => {});
      await db.query(`DELETE FROM issued_documents WHERE id=$1`, [docId]);
      throw unprocessable(m);
    };
    if (head.size !== Number(d.size_bytes) || head.size > max) return fail('Tamaño no coincide con lo declarado');
    const buf = await storage.read(d.object_key, max);
    const ver = verifyContent(buf, ['pdf'], d.original_name, MIME_BY_KIND.pdf);
    if (!ver.ok) return fail(ver.reason!);
    await db.tx(async (q) => {
      const r = await lockRequest(q, id);
      if (!['EN_TRAMITE', 'EMITIDA'].includes(r.status)) throw conflict('Estado no válido para cargar el documento');
      const v = (await q.query<any>(`SELECT COALESCE(max(version),0)+1 AS v FROM issued_documents WHERE request_id=$1`, [id]))[0].v;
      await q.query(`UPDATE issued_documents SET status='superseded' WHERE request_id=$1 AND status='verified'`, [id]);
      await q.query(`UPDATE issued_documents SET status='verified', version=$2, sha256=$3 WHERE id=$1`, [docId, v, ver.sha256]);
      await audit(q, user, 'issued.verified', 'request', id, { docId, version: v, sha256: ver.sha256 }, req.ip);
    });
    return { ok: true, docId };
  });

  // ---------- Emitir (EN_TRAMITE → EMITIDA) y finalizar ----------
  app.post('/api/admin/requests/:id/emit', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    requireIssue(user, await loadScoped(user, id));
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      const doc = (await q.query<any>(`SELECT 1 FROM issued_documents WHERE request_id=$1 AND status='verified'`, [id]))[0];
      if (!doc) throw unprocessable('Debe cargar el documento emitido antes de registrar la emisión');
      await applyTransition(q, { request: r, to: 'EMITIDA', actorKind: 'issue', actor: user, cfg });
      return { status: 'EMITIDA' };
    });
  });

  app.post('/api/admin/requests/:id/finalize', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ overrideReason: z.string().trim().min(10).max(500).optional() }).strict().parse(req.body ?? {});
    requireIssue(user, await loadScoped(user, id), 'request:finalize');
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      if (r.status !== 'EMITIDA') throw conflict(`Solo se puede finalizar una solicitud en estado EMITIDA (actual: ${r.status})`);
      const { config } = await getType(q, r.tramite_type_id);
      const unmet = await finalizeUnmet(q, id, config);
      const rc = await receiptState(q, id, r.status);
      // Normalmente el trámite se cierra solo cuando el solicitante confirma "Sí". Cerrar sin esa
      // confirmación (p. ej. no responde) exige dejar el motivo, que queda en el historial.
      if (rc.answer !== 'si' && !b.overrideReason)
        unmet.push(rc.answer === 'no' ? 'El solicitante reportó que el documento no le llegó correctamente: corríjalo y reenvíelo' : 'El solicitante aún no confirma que recibió correctamente el documento');
      if (unmet.length) throw unprocessable('No se cumplen las condiciones para finalizar el trámite', { unmet });
      await applyTransition(q, { request: r, to: 'FINALIZADA', actorKind: 'issue', actor: user, cfg, reason: rc.answer === 'si' ? undefined : `Cierre sin confirmación del solicitante: ${b.overrideReason}`, payloadExtra: { hasIssuedDocument: true } });
      await q.query(`UPDATE requests SET finalized_at=now() WHERE id=$1`, [id]);
      return { status: 'FINALIZADA' };
    });
  });

  // ---------- Reenviar documento corregido (tras un "No me llegó correctamente") ----------
  app.post('/api/admin/requests/:id/reissue', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const id = uuid.parse((req.params as any).id);
    requireIssue(user, await loadScoped(user, id));
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      if (r.status !== 'EMITIDA') throw conflict('Solo se puede reenviar un documento de una solicitud Emitida');
      const rc = await receiptState(q, id, r.status);
      if (!rc.openComplaint) throw conflict('No hay un reporte pendiente del solicitante');
      if (!rc.canResend) throw unprocessable('Cargue primero el documento corregido (una nueva versión del PDF)');
      await q.query(`UPDATE receipt_confirmations SET resolved_at=now(), resolved_by=$2 WHERE request_id=$1 AND answer='no' AND resolved_at IS NULL`, [id, user.id]);
      const owner = (await q.query<any>(`SELECT id,email FROM users WHERE id=$1`, [r.user_id]))[0];
      const type = (await q.query<any>(`SELECT name FROM tramite_types WHERE id=$1`, [r.tramite_type_id]))[0];
      await enqueue(q, {
        requestId: id, userId: owner.id, toEmail: owner.email, event: 'REEMITIDA', dedupeSuffix: rc.currentDocId!,
        payload: { code: r.code, name: r.apellidos_nombres, tramite: type?.name, link: `${cfg.APP_URL}/solicitud/${id}` },
      });
      await audit(q, user, 'issued.reissue', 'request', id, { docId: rc.currentDocId, version: rc.currentVersion }, req.ip);
      return { ok: true, version: rc.currentVersion };
    });
  });

  // ---------- Catálogo administrable de tipos de trámite ----------
  const typeBody = z.object({
    code: z.string().regex(/^[A-Z0-9_]{2,30}$/),
    name: z.string().min(2).max(100),
    groupLabel: z.string().min(2).max(60).default('Pregrado'),
    description: z.string().max(500).default(''),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    config: z.unknown().default({}),
  });

  app.get('/api/admin/tramite-types', async (req) => {
    requireStaff(req.user!, 'request:view');
    const rows = await db.query<any>(`SELECT * FROM tramite_types ORDER BY sort_order,name`);
    return rows.map((t) => ({ id: t.id, code: t.code, name: t.name, groupLabel: t.group_label, description: t.description, active: t.active, sortOrder: t.sort_order, version: t.version, config: parseConfig(t.config) }));
  });

  app.post('/api/admin/tramite-types', async (req, reply) => {
    const user = req.user!;
    requireStaff(user, 'catalog:manage');
    const b = typeBody.parse(req.body);
    const cfgParsed = tramiteConfigSchema.safeParse(b.config);
    if (!cfgParsed.success) throw unprocessable('Configuración del trámite inválida', Object.fromEntries(cfgParsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    try {
      const r = await db.query<any>(
        `INSERT INTO tramite_types(code,name,group_label,description,active,sort_order,config) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
        [b.code, b.name, b.groupLabel, b.description, b.active, b.sortOrder, JSON.stringify(cfgParsed.data)],
      );
      await audit(db, user, 'catalog.type_create', 'tramite_type', r[0].id, { code: b.code }, req.ip);
      return reply.status(201).send({ id: r[0].id });
    } catch (e: any) {
      if (String(e?.message).includes('unique') || e?.code === '23505') throw conflict('Ya existe un tipo de trámite con ese código');
      throw e;
    }
  });

  app.put('/api/admin/tramite-types/:id', async (req) => {
    const user = req.user!;
    requireStaff(user, 'catalog:manage');
    const id = uuid.parse((req.params as any).id);
    const b = typeBody.omit({ code: true }).parse(req.body);
    const cfgParsed = tramiteConfigSchema.safeParse(b.config);
    if (!cfgParsed.success) throw unprocessable('Configuración del trámite inválida', Object.fromEntries(cfgParsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    const r = await db.query<any>(
      `UPDATE tramite_types SET name=$2,group_label=$3,description=$4,active=$5,sort_order=$6,config=$7::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING id`,
      [id, b.name, b.groupLabel, b.description, b.active, b.sortOrder, JSON.stringify(cfgParsed.data)],
    );
    if (!r[0]) throw notFound();
    await audit(db, user, 'catalog.type_update', 'tramite_type', id, { active: b.active }, req.ip);
    return { ok: true };
  });
};
