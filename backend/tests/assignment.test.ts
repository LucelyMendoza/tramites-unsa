import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyContent } from '../src/storage/fileSniff.js';
import { DOMAIN, createSubmitted, makeCtx, type Ctx } from './helpers.js';

let ctx: Ctx;
let admin: string, reviewer: string, student: string;
let ids: Record<string, string> = {};
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await makeCtx();
  admin = ctx.token(`admin@${DOMAIN}`);
  reviewer = ctx.token(`revisor@${DOMAIN}`);
  student = ctx.token(`estudiante1@${DOMAIN}`, 'Estudiante Uno');
  for (const r of await ctx.db.query<any>(`SELECT u.id,u.email FROM users u JOIN staff_roles s ON s.user_id=u.id`)) ids[r.email.split('@')[0]] = r.id;
});
afterAll(() => ctx.close());

const rules = async () => (await ctx.call('GET', '/api/admin/assignment-rules', admin)).json as any[];
const typeId = async (code: string) => (await rules()).find((r) => r.code === code).tramiteTypeId as string;
const assignedOf = async (id: string) => (await ctx.db.query<any>(`SELECT assigned_to FROM requests WHERE id=$1`, [id]))[0].assigned_to;

describe('responsables por tipo de trámite', () => {
  it('solo el superadmin gestiona reglas y ausencias', async () => {
    expect((await ctx.call('GET', '/api/admin/assignment-rules', reviewer)).status).toBe(403);
    expect((await ctx.call('PUT', `/api/admin/availability/${ids.revisor}/absence`, reviewer, { from: today(), until: today(), substituteId: null })).status).toBe(403);
  });

  it('al enviar, la solicitud se asigna al responsable del tipo y se le avisa por correo', async () => {
    const t = await typeId('CONST_EGRESADO_PRE');
    expect((await ctx.call('PUT', `/api/admin/assignment-rules/${t}`, admin, { assigneeId: ids.revisor })).status).toBe(200);
    const pos = await typeId('CERT_ESTUDIOS_POS');
    expect((await ctx.call('PUT', `/api/admin/assignment-rules/${pos}`, admin, { assigneeId: ids['revisor.posgrado'] })).status).toBe(200);
    const { id } = await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE');
    expect(await assignedOf(id)).toBe(ids.revisor);
    const n = await ctx.db.query<any>(`SELECT event,to_email FROM notifications WHERE request_id=$1 ORDER BY created_at`, [id]);
    expect(n.map((x) => x.event)).toEqual(['REGISTRADA', 'ASIGNADA']);
    expect(n[1].to_email).toBe(`revisor@${DOMAIN}`);
    const p = await createSubmitted(ctx, student, 'CERT_ESTUDIOS_POS', {}, 'bio', { declarationAccepted: true });
    expect(await assignedOf(p.id)).toBe(ids['revisor.posgrado']);
  });

  it('el responsable debe ser personal activo', async () => {
    const t = await typeId('MULTA_NO_VOTAR');
    const s = (await ctx.db.query<any>(`SELECT id FROM users WHERE email=$1`, [`estudiante1@${DOMAIN}`]))[0].id;
    expect((await ctx.call('PUT', `/api/admin/assignment-rules/${t}`, admin, { assigneeId: s })).status).toBe(400);
  });
});

describe('ausencias (vacaciones) con suplente', () => {
  it('registrar la ausencia mueve lo abierto al suplente y lo nuevo también va al suplente', async () => {
    const before = await ctx.db.query<any>(`SELECT id FROM requests WHERE assigned_to=$1`, [ids.revisor]);
    expect(before.length).toBeGreaterThan(0);
    const r = await ctx.call('PUT', `/api/admin/availability/${ids.revisor}/absence`, admin, {
      from: today(), until: '2099-12-31', substituteId: ids['revisor.posgrado'], note: 'Vacaciones', reassignOpen: true,
    });
    expect(r.status).toBe(200);
    expect(r.json.moved).toBe(before.length);
    expect((await ctx.db.query<any>(`SELECT count(*)::int AS n FROM requests WHERE assigned_to=$1`, [ids.revisor]))[0].n).toBe(0);
    const { id } = await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE', { dni: '70000002' });
    expect(await assignedOf(id)).toBe(ids['revisor.posgrado']);
    const staff = (await ctx.call('GET', '/api/admin/availability', admin)).json.find((s: any) => s.id === ids.revisor);
    expect(staff.absence.active).toBe(true);
    expect(staff.openCount).toBe(0);
    const audit = await ctx.db.query<any>(`SELECT meta FROM audit_log WHERE action='request.assign' AND entity_id=$1`, [id]);
    expect(audit.some((a) => a.meta.why === 'ausencia')).toBe(true);
  });

  it('no se puede nombrar suplente a uno mismo ni fechas invertidas', async () => {
    expect((await ctx.call('PUT', `/api/admin/availability/${ids.emisor}/absence`, admin, { from: today(), until: today(), substituteId: ids.emisor })).status).toBe(400);
    expect((await ctx.call('PUT', `/api/admin/availability/${ids.emisor}/absence`, admin, { from: '2026-12-10', until: '2026-12-01', substituteId: null })).status).toBe(400);
  });

  it('al terminar la ausencia, lo nuevo vuelve al titular', async () => {
    expect((await ctx.call('DELETE', `/api/admin/availability/${ids.revisor}/absence`, admin)).status).toBe(200);
    const { id } = await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE', { dni: '70000003' });
    expect(await assignedOf(id)).toBe(ids.revisor);
  });

  it('reasignación masiva de lo abierto de una persona', async () => {
    const r = await ctx.call('POST', `/api/admin/availability/${ids['revisor.posgrado']}/reassign`, admin, { toUserId: ids.revisor });
    expect(r.status).toBe(200);
    expect(r.json.moved).toBe(r.json.total);
    expect((await ctx.db.query<any>(`SELECT count(*)::int AS n FROM requests WHERE assigned_to=$1 AND status<>'FINALIZADA'`, [ids['revisor.posgrado']]))[0].n).toBe(0);
  });
});

describe('PDF reales: sin falsos positivos', () => {
  const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1');
  it('acepta metadatos de macOS (/AAPL) y /OpenAction de vista inicial', () => {
    expect(verifyContent(pdf('<< /AAPL:Keywords [] /Producer (Quartz PDFContext) >>'), ['pdf'], 'a.pdf', 'application/pdf').ok).toBe(true);
    expect(verifyContent(pdf('<< /Type /Catalog /OpenAction [3 0 R /XYZ 0 792 0] >>'), ['pdf'], 'a.pdf', 'application/pdf').ok).toBe(true);
  });
  it('sigue rechazando JavaScript, Launch y archivos incrustados', () => {
    for (const b of ['<< /S /JavaScript /JS (app.alert(1)) >>', '<< /S /Launch/F (cmd.exe) >>', '<< /Names << /EmbeddedFiles 4 0 R >> >>'])
      expect(verifyContent(pdf(b), ['pdf'], 'a.pdf', 'application/pdf').ok).toBe(false);
  });
});
