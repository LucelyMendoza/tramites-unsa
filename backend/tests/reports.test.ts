import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN, createSubmitted, makeCtx, type Ctx } from './helpers.js';

let ctx: Ctx;
let admin: string, reviewer: string, student: string;
beforeAll(async () => {
  ctx = await makeCtx();
  admin = ctx.token(`admin@${DOMAIN}`);
  reviewer = ctx.token(`revisor@${DOMAIN}`);
  student = ctx.token(`estudiante1@${DOMAIN}`, 'E');
  const a = await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE');
  await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE', { dni: '70000002' });
  await createSubmitted(ctx, student, 'CERT_ESTUDIOS_PRE', { typeData: { aniosAcademicos: ['1°'] }, dni: '70000003' });
  await ctx.call('POST', `/api/admin/requests/${a.id}/review`, reviewer, { action: 'start_review' });
  await ctx.call('POST', `/api/admin/requests/${a.id}/review`, reviewer, { action: 'approve' });
});
afterAll(() => ctx.close());

describe('reportes', () => {
  it('tarjetas por tipo de trámite con totales y estados', async () => {
    const r = await ctx.call('GET', '/api/admin/reports/by-type', admin);
    expect(r.status).toBe(200);
    const eg = r.json.find((x: any) => x.code === 'CONST_EGRESADO_PRE');
    expect(eg.total).toBe(2);
    expect(eg.porEstado.EN_TRAMITE).toBe(1);
    expect(eg.abiertas).toBe(2);
    expect(r.json.find((x: any) => x.code === 'MULTA_NO_VOTAR').total).toBe(0);
    expect((await ctx.call('GET', '/api/admin/reports/by-type', student)).status).toBe(403);
  });
  it('volumen por mes, semestre y año (con periodos vacíos en cero)', async () => {
    const m = (await ctx.call('GET', '/api/admin/reports/volume?granularity=month', admin)).json;
    expect(m.periods).toHaveLength(12);
    expect(m.periods.at(-1).solicitadas).toBe(3);
    const s = (await ctx.call('GET', '/api/admin/reports/volume?granularity=semester', admin)).json;
    expect(s.periods).toHaveLength(6);
    expect(s.periods.at(-1).key).toMatch(/^\d{4}-[AB]$/);
    expect(s.periods.at(-1).solicitadas).toBe(3);
    const y = (await ctx.call('GET', '/api/admin/reports/volume?granularity=year', admin)).json;
    expect(y.periods).toHaveLength(5);
    expect(y.periods.at(-1).solicitadas).toBe(3);
  });
  it('actividad del personal: cuenta acciones por usuario y muestra el historial', async () => {
    const r = await ctx.call('GET', '/api/admin/reports/staff-activity', admin);
    expect(r.status).toBe(200);
    const rv = r.json.staff.find((s: any) => s.email === `revisor@${DOMAIN}`);
    expect(rv.revisiones).toBe(1);
    expect(rv.aprobadas).toBe(1);
    expect(r.json.feed[0].to).toBe('EN_TRAMITE');
    expect((await ctx.call('GET', '/api/admin/reports/staff-activity', ctx.token(`emisor@${DOMAIN}`))).status).toBe(403);
  });
});
