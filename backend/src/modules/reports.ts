import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { OPEN_STATUSES } from '../domain/assignment.js';
import { STATUSES } from '../domain/stateMachine.js';
import { requireStaff, type AuthUser } from './service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Perú no usa horario de verano: UTC−5 fijo. Evita depender de tzdata en el motor. */
const LIMA = `interval '5 hours'`;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Alcance por facultad + rango de fechas de envío (hora de Lima). */
function scopeWhere(user: AuthUser, f: { from?: string; to?: string; tramiteTypeId?: string }, alias = 'r') {
  const where = [`${alias}.status <> 'BORRADOR'`, `${alias}.submitted_at IS NOT NULL`];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (user.staff!.scope) add(`${alias}.faculty_id = ANY(?::uuid[])`, user.staff!.scope);
  if (f.from) add(`(${alias}.submitted_at - ${LIMA}) >= ?::date`, f.from);
  if (f.to) add(`(${alias}.submitted_at - ${LIMA}) < (?::date + interval '1 day')`, f.to);
  if (f.tramiteTypeId) add(`${alias}.tramite_type_id = ?::uuid`, f.tramiteTypeId);
  return { sql: where.join(' AND '), params };
}

export const reportRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const { db } = deps;

  // ---------- Resumen por tipo de trámite (tarjetas) ----------
  app.get('/api/admin/reports/by-type', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const f = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const w = scopeWhere(user, f);
    const statusCols = STATUSES.filter((s) => s !== 'BORRADOR').map((s) => `count(r.id) FILTER (WHERE r.status='${s}')::int AS "${s}"`).join(',');
    const rows = await db.query<any>(
      `SELECT t.id,t.code,t.name,t.group_label,t.sort_order,t.active,
              count(r.id)::int AS total,
              count(r.id) FILTER (WHERE r.status = ANY($${w.params.length + 1}::text[]))::int AS abiertas,
              count(r.id) FILTER (WHERE r.assigned_to IS NULL AND r.status = ANY($${w.params.length + 1}::text[]))::int AS sin_asignar,
              count(r.id) FILTER (WHERE r.submitted_at >= now() - interval '30 days')::int AS ultimos_30,
              round(avg(EXTRACT(EPOCH FROM (r.finalized_at - r.submitted_at)) / 86400) FILTER (WHERE r.finalized_at IS NOT NULL)::numeric, 1) AS dias_promedio,
              ${statusCols}
         FROM tramite_types t
         LEFT JOIN requests r ON r.tramite_type_id=t.id AND ${w.sql}
        WHERE t.active OR r.id IS NOT NULL
        GROUP BY t.id ORDER BY t.active DESC, t.sort_order, t.name`,
      [...w.params, OPEN_STATUSES],
    );
    return rows.map((r) => ({
      tramiteTypeId: r.id, code: r.code, name: r.active ? r.name : `${r.name} (tipo anterior)`, group: r.active ? r.group_label : 'Tipos anteriores (inactivos)', active: r.active,
      total: r.total, abiertas: r.abiertas, sinAsignar: r.sin_asignar, ultimos30: r.ultimos_30,
      diasPromedio: r.dias_promedio == null ? null : Number(r.dias_promedio),
      porEstado: Object.fromEntries(STATUSES.filter((s) => s !== 'BORRADOR').map((s) => [s, r[s]])),
    }));
  });

  // ---------- Volumen por mes / semestre / año ----------
  app.get('/api/admin/reports/volume', async (req) => {
    const user = req.user!;
    requireStaff(user, 'request:view');
    const f = z.object({ granularity: z.enum(['month', 'semester', 'year']).default('month'), tramiteTypeId: z.string().uuid().optional() }).parse(req.query);
    const now = new Date(Date.now() - 5 * 3600 * 1000); // hoy en Lima
    const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-11
    // Periodos (orden cronológico) y fecha de inicio del rango.
    let periods: { key: string; label: string }[] = [];
    let from: string;
    if (f.granularity === 'month') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - i, 1));
        periods.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
      }
      from = `${periods[0].key}-01`;
    } else if (f.granularity === 'semester') {
      // Semestre A = enero–junio, B = julio–diciembre (ajustable al calendario académico oficial).
      let sy = y, sh = m < 6 ? 0 : 1;
      const list: { key: string; label: string }[] = [];
      for (let i = 0; i < 6; i++) { list.unshift({ key: `${sy}-${sh ? 'B' : 'A'}`, label: `${sy}-${sh ? 'B' : 'A'}` }); if (sh === 1) sh = 0; else { sh = 1; sy--; } }
      periods = list;
      const [fy, fs] = periods[0].key.split('-');
      from = `${fy}-${fs === 'A' ? '01' : '07'}-01`;
    } else {
      for (let i = 4; i >= 0; i--) periods.push({ key: String(y - i), label: String(y - i) });
      from = `${y - 4}-01-01`;
    }
    const keyExpr =
      f.granularity === 'month' ? `to_char(ts, 'YYYY-MM')`
      : f.granularity === 'semester' ? `to_char(ts, 'YYYY') || '-' || CASE WHEN EXTRACT(MONTH FROM ts) <= 6 THEN 'A' ELSE 'B' END`
      : `to_char(ts, 'YYYY')`;
    const w = scopeWhere(user, { from, tramiteTypeId: f.tramiteTypeId });
    const count = async (col: 'submitted_at' | 'finalized_at') =>
      db.query<any>(
        `SELECT k AS key, count(*)::int AS n FROM (
           SELECT ${keyExpr.replaceAll('ts', `(r.${col} - ${LIMA})`)} AS k FROM requests r WHERE ${w.sql} AND r.${col} IS NOT NULL
         ) x GROUP BY k`,
        w.params,
      );
    const [sub, fin] = await Promise.all([count('submitted_at'), count('finalized_at')]);
    const m1 = new Map(sub.map((r) => [r.key, r.n])), m2 = new Map(fin.map((r) => [r.key, r.n]));
    return { granularity: f.granularity, periods: periods.map((p) => ({ ...p, solicitadas: m1.get(p.key) ?? 0, finalizadas: m2.get(p.key) ?? 0 })) };
  });

  // ---------- Actividad del personal ----------
  app.get('/api/admin/reports/staff-activity', async (req) => {
    const user = req.user!;
    requireStaff(user, 'report:export');
    const f = z.object({ from: isoDate.optional(), to: isoDate.optional(), userId: z.string().uuid().optional() }).parse(req.query);
    const params: unknown[] = [];
    const cond: string[] = ['true'];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (user.staff!.scope) add(`r.faculty_id = ANY(?::uuid[])`, user.staff!.scope);
    if (f.from) add(`(h.created_at - ${LIMA}) >= ?::date`, f.from);
    if (f.to) add(`(h.created_at - ${LIMA}) < (?::date + interval '1 day')`, f.to);
    const where = cond.join(' AND ');
    const summary = await db.query<any>(
      `SELECT u.id,u.email,u.display_name,s.role,
              count(h.id) FILTER (WHERE h.to_status='EN_REVISION')::int AS revisiones,
              count(h.id) FILTER (WHERE h.to_status='EN_TRAMITE')::int AS aprobadas,
              count(h.id) FILTER (WHERE h.to_status='REQUIERE_SUBSANACION')::int AS subsanaciones,
              count(h.id) FILTER (WHERE h.to_status='EMITIDA')::int AS emitidas,
              count(h.id) FILTER (WHERE h.to_status='FINALIZADA')::int AS finalizadas,
              max(h.created_at) AS ultima,
              (SELECT count(*)::int FROM requests ra WHERE ra.assigned_to=u.id AND ra.status = ANY($${params.length + 1}::text[])) AS abiertas
         FROM staff_roles s JOIN users u ON u.id=s.user_id
         LEFT JOIN (status_history h JOIN requests r ON r.id=h.request_id) ON h.actor_id=u.id AND ${where}
        WHERE s.active GROUP BY u.id,s.role ORDER BY count(h.id) DESC, u.display_name`,
      [...params, OPEN_STATUSES],
    );
    const reissued = await db.query<any>(
      `SELECT a.actor_id, count(*)::int AS n FROM audit_log a JOIN requests r ON r.id::text=a.entity_id::text
        WHERE a.action='issued.reissue' ${user.staff!.scope ? `AND r.faculty_id = ANY($1::uuid[])` : ''} GROUP BY a.actor_id`,
      user.staff!.scope ? [user.staff!.scope] : [],
    );
    const re = new Map(reissued.map((r) => [r.actor_id, r.n]));
    const feedParams = [...params];
    let feedWhere = where.replaceAll('h.created_at', 'h.created_at');
    if (f.userId) { feedParams.push(f.userId); feedWhere += ` AND h.actor_id = $${feedParams.length}::uuid`; }
    const feed = await db.query<any>(
      `SELECT h.created_at,h.from_status,h.to_status,h.reason,u.email,u.display_name,r.id AS request_id,r.code,t.name AS tramite
         FROM status_history h JOIN requests r ON r.id=h.request_id JOIN users u ON u.id=h.actor_id
         JOIN staff_roles s ON s.user_id=u.id JOIN tramite_types t ON t.id=r.tramite_type_id
        WHERE ${feedWhere} ORDER BY h.created_at DESC LIMIT 60`,
      feedParams,
    );
    return {
      staff: summary.map((s) => ({
        id: s.id, email: s.email, name: s.display_name, role: s.role,
        revisiones: s.revisiones, aprobadas: s.aprobadas, subsanaciones: s.subsanaciones, emitidas: s.emitidas,
        finalizadas: s.finalizadas, reenviosCorregidos: re.get(s.id) ?? 0, abiertasAsignadas: s.abiertas, ultimaActividad: s.ultima,
      })),
      feed: feed.map((x) => ({ at: x.created_at, from: x.from_status, to: x.to_status, reason: x.reason, actor: x.display_name || x.email, requestId: x.request_id, code: x.code, tramite: x.tramite })),
    };
  });
};
