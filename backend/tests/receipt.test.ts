import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN, PDF, createSubmitted, makeCtx, type Ctx } from './helpers.js';

let ctx: Ctx;
let student: string, other: string, reviewer: string, admin: string, issuer: string;
let id: string;
let reviewerId: string;

const uploadIssued = async (tok: string, name = 'constancia.pdf', data = PDF) => {
  const p = await ctx.call('POST', `/api/admin/requests/${id}/issued/presign`, tok, { filename: name, size: data.length });
  expect(p.status).toBe(200);
  await ctx.app.inject({ method: 'PUT', url: new URL(p.json.upload.url).pathname, headers: { 'content-type': 'application/pdf' }, payload: data });
  return ctx.call('POST', `/api/admin/requests/${id}/issued/${p.json.docId}/complete`, tok, {});
};

beforeAll(async () => {
  ctx = await makeCtx();
  student = ctx.token(`estudiante1@${DOMAIN}`, 'Estudiante Uno');
  other = ctx.token(`estudiante2@${DOMAIN}`, 'Estudiante Dos');
  reviewer = ctx.token(`revisor@${DOMAIN}`);
  issuer = ctx.token(`emisor@${DOMAIN}`);
  admin = ctx.token(`admin@${DOMAIN}`);
  reviewerId = (await ctx.db.query<any>(`SELECT id FROM users WHERE email=$1`, [`revisor@${DOMAIN}`]))[0].id;
  // Regla: la constancia de egresado pregrado la atiende el revisor
  const rules = (await ctx.call('GET', '/api/admin/assignment-rules', admin)).json;
  const t = rules.find((r: any) => r.code === 'CONST_EGRESADO_PRE').tramiteTypeId;
  await ctx.call('PUT', `/api/admin/assignment-rules/${t}`, admin, { assigneeId: reviewerId });
  id = (await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE')).id;
});
afterAll(() => ctx.close());

describe('el responsable asignado puede emitir', () => {
  it('el personal revisor carga el PDF y registra la emisión; el solicitante no puede', async () => {
    await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'start_review' });
    await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'approve' });
    expect((await ctx.call('POST', `/api/admin/requests/${id}/issued/presign`, student, { filename: 'x.pdf', size: PDF.length })).status).toBe(403);
    // otro revisor (no asignado) también puede atenderlo si la solicitud está en su alcance
    const posg = ctx.token(`revisor.posgrado@${DOMAIN}`);
    expect((await ctx.call('GET', `/api/admin/requests/${id}`, posg)).json.can.issue).toBe(true);
    const det = (await ctx.call('GET', `/api/admin/requests/${id}`, reviewer)).json;
    expect(det.can.issue).toBe(true);
    expect((await uploadIssued(reviewer)).status).toBe(200);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, reviewer)).status).toBe(200);
  });
});

describe('encuesta obligatoria de recepción', () => {
  it('queda pendiente para el solicitante (y solo para él)', async () => {
    const p = (await ctx.call('GET', '/api/me/pending-receipts', student)).json;
    expect(p.map((x: any) => x.requestId)).toContain(id);
    expect((await ctx.call('GET', '/api/me/pending-receipts', other)).json).toEqual([]);
    expect((await ctx.call('POST', `/api/requests/${id}/receipt`, other, { answer: 'si' })).status).toBe(404);
    const d = (await ctx.call('GET', `/api/requests/${id}`, student)).json;
    expect(d.receipt.pending).toBe(true);
  });

  it('"No" exige mensaje, avisa al responsable y bloquea el cierre', async () => {
    expect((await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'no' })).status).toBe(422);
    const r = await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'no', message: 'El documento tiene mal escrito mi segundo apellido' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('EMITIDA');
    expect((await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'si' })).status).toBe(409); // ya respondió esa versión
    const n = await ctx.db.query<any>(`SELECT to_email,payload FROM notifications WHERE request_id=$1 AND event='RECEPCION_OBSERVADA'`, [id]);
    expect(n[0].to_email).toBe(`revisor@${DOMAIN}`);
    expect(n[0].payload.reason).toMatch(/segundo apellido/);
    const det = (await ctx.call('GET', `/api/admin/requests/${id}`, reviewer)).json;
    expect(det.receipt.openComplaint.message).toMatch(/segundo apellido/);
    expect(det.receipt.canResend).toBe(false);
    const fin = await ctx.call('POST', `/api/admin/requests/${id}/finalize`, reviewer);
    expect(fin.status).toBe(422);
    expect(fin.json.details.unmet.join(' ')).toMatch(/no le llegó correctamente/);
  });

  it('el responsable sube la versión corregida y la reenvía; el solicitante vuelve a responder', async () => {
    expect((await ctx.call('POST', `/api/admin/requests/${id}/reissue`, reviewer)).status).toBe(422); // aún sin nueva versión
    expect((await uploadIssued(reviewer, 'constancia-corregida.pdf')).status).toBe(200);
    const re = await ctx.call('POST', `/api/admin/requests/${id}/reissue`, reviewer);
    expect(re.status).toBe(200);
    expect(re.json.version).toBe(2);
    const mail = await ctx.db.query<any>(`SELECT to_email FROM notifications WHERE request_id=$1 AND event='REEMITIDA'`, [id]);
    expect(mail[0].to_email).toBe(`estudiante1@${DOMAIN}`);
    const d = (await ctx.call('GET', `/api/requests/${id}`, student)).json;
    expect(d.receipt.pending).toBe(true);
    expect(d.issuedDocuments.filter((x: any) => x.status === 'verified')[0].version).toBe(2);
    const ok = await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'si' });
    expect(ok.json.status).toBe('FINALIZADA');
    const hist = (await ctx.call('GET', `/api/admin/requests/${id}`, admin)).json.receipt.history;
    expect(hist.map((h: any) => [h.version, h.answer, !!h.resolvedAt])).toEqual([[1, 'no', true], [2, 'si', false]]);
  });

  it('cerrar sin confirmación exige un motivo y queda en el historial', async () => {
    const id2 = (await createSubmitted(ctx, student, 'CONST_EGRESADO_PRE', { dni: '70000002' })).id;
    await ctx.call('POST', `/api/admin/requests/${id2}/review`, admin, { action: 'start_review' });
    await ctx.call('POST', `/api/admin/requests/${id2}/review`, admin, { action: 'approve' });
    const p = await ctx.call('POST', `/api/admin/requests/${id2}/issued/presign`, issuer, { filename: 'c.pdf', size: PDF.length });
    await ctx.app.inject({ method: 'PUT', url: new URL(p.json.upload.url).pathname, headers: { 'content-type': 'application/pdf' }, payload: PDF });
    await ctx.call('POST', `/api/admin/requests/${id2}/issued/${p.json.docId}/complete`, issuer, {});
    await ctx.call('POST', `/api/admin/requests/${id2}/emit`, issuer);
    expect((await ctx.call('POST', `/api/admin/requests/${id2}/finalize`, issuer, { overrideReason: 'corto' })).status).toBe(400);
    const f = await ctx.call('POST', `/api/admin/requests/${id2}/finalize`, issuer, { overrideReason: 'El solicitante no responde tras 3 recordatorios' });
    expect(f.status).toBe(200);
    const h = (await ctx.call('GET', `/api/admin/requests/${id2}`, admin)).json.history.at(-1);
    expect(h.reason).toMatch(/sin confirmación/);
  });
});
