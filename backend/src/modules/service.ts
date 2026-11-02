import type { Config } from '../config.js';
import type { Db, Queryable } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { findTransition, type Actor, type NotifyEvent, type Status } from '../domain/stateMachine.js';
import { inScope, type Permission, type StaffRole, can } from '../domain/permissions.js';
import { parseConfig, type TramiteConfig } from '../domain/tramiteConfig.js';
import { enqueue } from '../notifications/outbox.js';
import { routeOnArrival } from '../domain/assignment.js';
import { receiptState } from '../domain/receipt.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  applicantType: 'estudiante' | 'egresado';
  staff?: { role: StaffRole; scope: string[] | null };
}

export interface Target {
  type: 'file' | 'field';
  key: string;
}

export async function audit(
  q: Queryable,
  actor: { id?: string; email?: string } | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: Record<string, unknown> = {},
  ip?: string,
) {
  await q.query(
    `INSERT INTO audit_log(actor_id,actor_email,action,entity,entity_id,meta,ip) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [actor?.id ?? null, actor?.email ?? null, action, entity, entityId, JSON.stringify(meta), ip ?? null],
  );
}

export function requireStaff(user: AuthUser, perm: Permission) {
  if (!user.staff || !can(user.staff.role, perm)) throw forbidden();
  return user.staff;
}

export function assertScope(user: AuthUser, facultyId: string) {
  if (!user.staff || !inScope(user.staff.scope, facultyId)) throw notFound('Solicitud no encontrada');
}

export async function nextCode(q: Queryable, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const r = await q.query<{ last_value: number }>(
    `INSERT INTO request_counters(year,last_value) VALUES ($1,1)
     ON CONFLICT (year) DO UPDATE SET last_value = request_counters.last_value + 1 RETURNING last_value`,
    [year],
  );
  return `TD-${year}-${String(r[0].last_value).padStart(6, '0')}`;
}

export async function lockRequest(q: Queryable, id: string) {
  const rows = await q.query<any>(`SELECT * FROM requests WHERE id=$1 FOR UPDATE`, [id]);
  if (!rows[0]) throw notFound('Solicitud no encontrada');
  return rows[0];
}

export async function getType(q: Queryable, id: string) {
  const rows = await q.query<any>(`SELECT * FROM tramite_types WHERE id=$1`, [id]);
  if (!rows[0]) throw badRequest('Tipo de trámite inexistente');
  return { row: rows[0], config: parseConfig(rows[0].config) as TramiteConfig };
}

export const BASIC_FIELD_LABELS: Record<string, string> = {
  dni: 'DNI',
  cui: 'CUI',
  faculty_id: 'Facultad',
  school_id: 'Escuela profesional',
};

export function labelTargets(targets: Target[], cfg: TramiteConfig) {
  return targets.map((t) => {
    if (t.type === 'file') {
      const d = cfg.requiredDocs.find((x) => x.slot === t.key);
      return { type: t.type, label: d?.label ?? t.key };
    }
    if (t.key.startsWith('td.')) {
      const f = cfg.fields.find((x) => x.key === t.key.slice(3));
      return { type: t.type, label: f?.label ?? t.key };
    }
    return { type: t.type, label: BASIC_FIELD_LABELS[t.key] ?? t.key };
  });
}

export function validateTargets(targets: Target[], cfg: TramiteConfig): Target[] {
  const valid = new Set<string>([
    ...cfg.requiredDocs.map((d) => `file:${d.slot}`),
    ...Object.keys(BASIC_FIELD_LABELS).map((k) => `field:${k}`),
    ...cfg.fields.map((f) => `field:td.${f.key}`),
  ]);
  const out: Target[] = [];
  for (const t of targets) {
    if (!valid.has(`${t.type}:${t.key}`)) throw badRequest(`Objetivo de corrección inválido: ${t.type}:${t.key}`);
    if (!out.some((o) => o.type === t.type && o.key === t.key)) out.push(t);
  }
  return out;
}

/** Qué puede modificar el solicitante mientras la solicitud está en subsanación. */
export async function editableTargets(q: Queryable, requestId: string) {
  const obs = await q.query<any>(
    `SELECT targets FROM observations WHERE request_id=$1 AND kind='subsanacion' AND resolved_at IS NULL`,
    [requestId],
  );
  const targets: Target[] = obs.flatMap((o) => o.targets as Target[]);
  return {
    all: targets.length === 0,
    files: new Set(targets.filter((t) => t.type === 'file').map((t) => t.key)),
    fields: new Set(targets.filter((t) => t.type === 'field').map((t) => t.key)),
    targets,
  };
}

interface TransitionInput {
  request: any;
  to: Status;
  actorKind: Actor;
  actor: AuthUser;
  reason?: string;
  payloadExtra?: { reason?: string; targets?: { type: 'file' | 'field'; label: string }[]; hasIssuedDocument?: boolean };
  cfg: Config;
}

/** ÚNICO punto por el que cambia el estado de una solicitud. Debe llamarse dentro de una transacción con la fila bloqueada. */
export async function applyTransition(q: Queryable, t: TransitionInput) {
  const from = t.request.status as Status;
  const tr = findTransition(from, t.to, t.actorKind);
  if (!tr) throw conflict(`Transición no permitida: ${from} → ${t.to}`);
  if (tr.reasonRequired && !(t.reason && t.reason.trim().length >= 5)) throw badRequest('Debe indicar el motivo');

  await q.query(`UPDATE requests SET status=$2, updated_at=now() WHERE id=$1`, [t.request.id, t.to]);
  const h = await q.query<{ id: string }>(
    `INSERT INTO status_history(request_id,from_status,to_status,actor_id,reason) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [t.request.id, from, t.to, t.actor.id, t.reason ?? null],
  );
  await audit(q, t.actor, 'request.transition', 'request', t.request.id, { from, to: t.to, reason: t.reason ?? null });

  if (tr.notify) {
    const owner = (await q.query<any>(`SELECT id,email,display_name FROM users WHERE id=$1`, [t.request.user_id]))[0];
    const type = (await q.query<any>(`SELECT name FROM tramite_types WHERE id=$1`, [t.request.tramite_type_id]))[0];
    const code = (await q.query<any>(`SELECT code FROM requests WHERE id=$1`, [t.request.id]))[0].code;
    await enqueue(q, {
      requestId: t.request.id,
      userId: owner.id,
      toEmail: owner.email,
      event: tr.notify as NotifyEvent,
      dedupeSuffix: h[0].id,
      payload: {
        code,
        name: t.request.apellidos_nombres,
        tramite: type?.name,
        link: `${t.cfg.APP_URL}/solicitud/${t.request.id}`,
        ...t.payloadExtra,
      },
    });
  }
  // Asignación automática por tipo de trámite y derivación al suplente si el responsable está ausente.
  if (t.to === 'ENVIADA' || t.to === 'REENVIADA') await routeOnArrival(q, t.cfg, t.request.id);
  return from;
}

export function actorLabel(actorId: string, viewerId: string, viewerIsStaff: boolean, email?: string) {
  if (viewerIsStaff) return email ?? actorId;
  return actorId === viewerId ? 'Usted' : 'Unidad administrativa';
}

/** Detalle completo de una solicitud. `viewer='applicant'` oculta notas internas, identidad del personal y metadatos de control. */
export async function loadDetail(db: Db | Queryable, id: string, viewer: 'applicant' | 'staff', viewerId: string) {
  const reqRows = await db.query<any>(
    `SELECT r.*, f.name AS faculty_name, s.name AS school_name, p.name AS program_name,
            t.name AS tramite_name, t.group_label, u.email AS owner_email, a.email AS assigned_email
       FROM requests r
       JOIN faculties f ON f.id=r.faculty_id JOIN schools s ON s.id=r.school_id
       LEFT JOIN programs p ON p.id=r.program_id
       JOIN tramite_types t ON t.id=r.tramite_type_id
       JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.assigned_to
      WHERE r.id=$1`,
    [id],
  );
  const r = reqRows[0];
  if (!r) throw notFound('Solicitud no encontrada');
  const { config } = await getType(db, r.tramite_type_id);
  const files = await db.query<any>(
    `SELECT id,slot,version,original_name,size_bytes,detected_content_type,status,is_current,uploaded_at
       FROM request_files WHERE request_id=$1 AND status IN ('verified','superseded') ORDER BY slot, version`,
    [id],
  );
  const obs = await db.query<any>(
    `SELECT o.id,o.kind,o.reason,o.targets,o.resolved_at,o.created_at,o.author_id,u.email AS author_email
       FROM observations o JOIN users u ON u.id=o.author_id
      WHERE o.request_id=$1 ${viewer === 'applicant' ? "AND o.kind='subsanacion'" : ''} ORDER BY o.created_at`,
    [id],
  );
  const hist = await db.query<any>(
    `SELECT h.id,h.from_status,h.to_status,h.reason,h.created_at,h.actor_id,u.email AS actor_email
       FROM status_history h JOIN users u ON u.id=h.actor_id WHERE h.request_id=$1 ORDER BY h.created_at, h.id`,
    [id],
  );
  const decl = (await db.query<any>(`SELECT * FROM declarations WHERE request_id=$1`, [id]))[0];
  const issuedAll = await db.query<any>(
    `SELECT id,version,original_name,size_bytes,status,issued_at FROM issued_documents WHERE request_id=$1 AND status IN ('verified','superseded') ORDER BY version`,
    [id],
  );
  const issued = viewer === 'applicant' && !['EMITIDA', 'FINALIZADA'].includes(r.status) ? [] : issuedAll;
  const isStaff = viewer === 'staff';
  const receipt = await receiptState(db, id, r.status);
  const targetLabels = (t: Target[]) => labelTargets(t, config);

  return {
    id: r.id,
    code: r.code,
    status: r.status as Status,
    applicantType: r.applicant_type,
    apellidosNombres: r.apellidos_nombres,
    dni: r.dni,
    cui: r.cui,
    facultyId: r.faculty_id,
    facultyName: r.faculty_name,
    schoolId: r.school_id,
    schoolName: r.school_name,
    programId: r.program_id,
    programName: r.program_name,
    tramiteTypeId: r.tramite_type_id,
    tramiteName: r.tramite_name,
    typeData: r.type_data,
    config: { requiredDocs: config.requiredDocs, fields: config.fields, requiresDeclaration: config.requiresDeclaration, finalizeRequires: config.finalizeRequires },
    resubmitCount: r.resubmit_count,
    receipt,
    submittedAt: r.submitted_at,
    finalizedAt: r.finalized_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(isStaff ? { ownerEmail: r.owner_email, assignedTo: r.assigned_to, assignedEmail: r.assigned_email, directoryCheck: r.directory_check } : {}),
    files: files.map((f) => ({
      id: f.id,
      slot: f.slot,
      version: f.version,
      originalName: f.original_name,
      sizeBytes: Number(f.size_bytes),
      contentType: f.detected_content_type,
      status: f.status,
      isCurrent: f.is_current,
      uploadedAt: f.uploaded_at,
    })),
    observations: obs.map((o) => ({
      id: o.id,
      kind: o.kind,
      reason: o.reason,
      targets: o.targets,
      targetLabels: targetLabels(o.targets),
      resolvedAt: o.resolved_at,
      createdAt: o.created_at,
      author: isStaff ? o.author_email : 'Unidad administrativa',
    })),
    history: hist.map((h) => ({
      id: h.id,
      from: h.from_status,
      to: h.to_status,
      reason: h.reason,
      at: h.created_at,
      actor: actorLabel(h.actor_id, viewerId, isStaff, h.actor_email),
    })),
    declaration: decl
      ? {
          textVersion: decl.text_version,
          text: decl.text_snapshot,
          acceptedAt: decl.accepted_at,
          verificationStatus: decl.verification_status,
          verificationNote: isStaff ? decl.verification_note : undefined,
          verifiedAt: decl.verified_at,
        }
      : null,
    issuedDocuments: issued.map((d) => ({
      id: d.id,
      version: d.version,
      originalName: d.original_name,
      sizeBytes: Number(d.size_bytes),
      status: d.status,
      issuedAt: d.issued_at,
    })),
  };
}
