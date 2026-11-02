import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processOutbox } from '../src/notifications/outbox.js';
import { DOMAIN, JPG, PDF, PNG, createSubmitted, draftBody, makeCtx, uploadFile, type Ctx } from './helpers.js';

let ctx: Ctx;
let student: string, reviewer: string, issuer: string, admin: string;

beforeAll(async () => {
  ctx = await makeCtx();
  student = ctx.token(`estudiante1@${DOMAIN}`, 'Estudiante Uno');
  reviewer = ctx.token(`revisor@${DOMAIN}`);
  issuer = ctx.token(`emisor@${DOMAIN}`);
  admin = ctx.token(`admin@${DOMAIN}`);
});
afterAll(() => ctx.close());

describe('flujo completo: envío → subsanación → emisión → finalización', () => {
  let id: string;
  let code: string;

  it('el solicitante registra, adjunta y envía; se genera código único y correo REGISTRADA', async () => {
    const r = await createSubmitted(ctx, student, 'CERT_ESTUDIOS_PRE', { typeData: { aniosAcademicos: ['1°', '2°'] } });
    id = r.id;
    expect(r.submit.status).toBe(200);
    code = r.submit.json.code;
    expect(code).toMatch(/^TD-\d{4}-\d{6}$/);
    expect(r.submit.json.status).toBe('ENVIADA');
    const n = await ctx.db.query<any>(`SELECT event,status FROM notifications WHERE request_id=$1`, [id]);
    expect(n.map((x) => x.event)).toEqual(['REGISTRADA']);
  });

  it('el revisor toma la solicitud y pide subsanar el DNI con motivo', async () => {
    const start = await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'start_review' });
    expect(start.status).toBe(200);
    // motivo obligatorio
    const bad = await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'request_correction', reason: 'x', targets: [] });
    expect(bad.status).toBe(400);
    const ok = await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, {
      action: 'request_correction',
      reason: 'La fotografía del DNI está borrosa y no se lee el número',
      targets: [{ type: 'file', key: 'DNI' }],
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('REQUIERE_SUBSANACION');
  });

  it('no se puede reenviar sin corregir lo observado', async () => {
    const r = await ctx.call('POST', `/api/requests/${id}/submit`, student, {});
    expect(r.status).toBe(422);
    expect(r.json.details.pending[0]).toMatch(/DNI/);
  });

  it('solo se pueden reemplazar los documentos observados', async () => {
    const r = await uploadFile(ctx, student, id, 'BOLETA', 'boleta.pdf', 'application/pdf', PDF);
    expect(r.presign.status).toBe(403);
  });

  it('el solicitante reemplaza el DNI y reenvía con el MISMO código; se conservan versiones', async () => {
    const up = await uploadFile(ctx, student, id, 'DNI', 'dni-nuevo.jpg', 'image/jpeg', JPG);
    expect(up.complete.status).toBe(200);
    const r = await ctx.call('POST', `/api/requests/${id}/submit`, student, {});
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(code);
    expect(r.json.status).toBe('REENVIADA');
    const d = (await ctx.call('GET', `/api/requests/${id}`, student)).json;
    expect(d.code).toBe(code);
    expect(d.resubmitCount).toBe(1);
    const dni = d.files.filter((f: any) => f.slot === 'DNI');
    expect(dni.map((f: any) => [f.version, f.isCurrent, f.status])).toEqual([
      [1, false, 'superseded'],
      [2, true, 'verified'],
    ]);
    expect(d.observations[0].resolvedAt).toBeTruthy();
    expect(d.history.map((h: any) => h.to)).toEqual(['ENVIADA', 'EN_REVISION', 'REQUIERE_SUBSANACION', 'REENVIADA']);
  });

  it('no se puede finalizar saltando etapas ni sin documento emitido', async () => {
    expect((await ctx.call('POST', `/api/admin/requests/${id}/finalize`, issuer)).status).toBe(409);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, issuer)).status).toBe(422);
  });

  it('revisa, aprueba, emite con PDF y finaliza', async () => {
    expect((await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'start_review' })).status).toBe(200);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'approve' })).status).toBe(200);
    // el solicitante nunca puede emitir
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, student)).status).toBe(403);
    // el emisor carga el documento
    const p = await ctx.call('POST', `/api/admin/requests/${id}/issued/presign`, issuer, { filename: 'certificado.pdf', size: PDF.length });
    expect(p.status).toBe(200);
    await ctx.app.inject({ method: 'PUT', url: new URL(p.json.upload.url).pathname, headers: { 'content-type': 'application/pdf' }, payload: PDF });
    expect((await ctx.call('POST', `/api/admin/requests/${id}/issued/${p.json.docId}/complete`, issuer, {})).status).toBe(200);
    // aún no visible al solicitante
    expect((await ctx.call('GET', `/api/issued/${p.json.docId}/download-url`, student)).status).toBe(404);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, issuer)).status).toBe(200);
    const dl = await ctx.call('GET', `/api/issued/${p.json.docId}/download-url`, student);
    expect(dl.status).toBe(200);
    expect(dl.json.expiresInSeconds).toBeLessThanOrEqual(60);
    // Sin confirmación del solicitante el emisor no puede cerrar (salvo motivo explícito)
    expect((await ctx.call('POST', `/api/admin/requests/${id}/finalize`, issuer)).status).toBe(422);
    // Encuesta obligatoria: el solicitante confirma que le llegó bien → se finaliza solo
    const fin = await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'si' });
    expect(fin.status).toBe(200);
    expect(fin.json.status).toBe('FINALIZADA');
    const d = (await ctx.call('GET', `/api/requests/${id}`, student)).json;
    expect(d.status).toBe('FINALIZADA');
  });

  it('los correos se entregan, con código, motivo y enlace, y SIN adjuntos ni datos sensibles', async () => {
    const r = await processOutbox(ctx.db, ctx.mail, ctx.cfg, 50);
    expect(r.sent).toBeGreaterThanOrEqual(6);
    const mails = ctx.mail.sent.filter((m) => m.subject.includes(code));
    const subjects = mails.map((m) => m.subject);
    expect(subjects.some((s) => /registrada/.test(s))).toBe(true);
    expect(subjects.some((s) => /subsanación/.test(s))).toBe(true);
    expect(subjects.some((s) => /recibida/.test(s))).toBe(true);
    expect(subjects.some((s) => /en trámite/.test(s))).toBe(true);
    expect(subjects.some((s) => /emitido/.test(s))).toBe(true);
    expect(subjects.some((s) => /finalizado/.test(s))).toBe(true);
    const rej = mails.find((m) => /requiere subsanación/.test(m.subject))!;
    expect(rej.text).toContain(code);
    expect(rej.text).toContain('borrosa');
    expect(rej.text).toContain('Documento de identidad');
    expect(rej.text).toContain(`/solicitud/${id}`);
    for (const m of mails) {
      expect(m.text + m.html).not.toMatch(/70000001|20201001/); // DNI / CUI
      expect(Object.keys(m)).not.toContain('attachments');
    }
    const fin = mails.find((m) => /finalizado/.test(m.subject))!;
    expect(fin.text).toMatch(/descargar el documento final/);
    // estado de envío registrado
    const rows = await ctx.db.query<any>(`SELECT status,attempts,sent_at FROM notifications WHERE request_id=$1`, [id]);
    expect(rows.every((x) => x.status === 'sent' && x.attempts === 1 && x.sent_at)).toBe(true);
    // el historial del usuario incluye sus notificaciones
    const mine = (await ctx.call('GET', '/api/me/notifications', student)).json;
    expect(mine.length).toBeGreaterThanOrEqual(6);
  });

  it('queda auditoría de cada acción relevante', async () => {
    const a = (await ctx.call('GET', `/api/admin/audit?entity=request&entityId=${id}`, admin)).json;
    const actions = new Set(a.map((x: any) => x.action));
    for (const k of ['request.transition', 'file.verified', 'issued.verified']) expect(actions.has(k)).toBe(true);
  });
});

describe('Posgrado: declaración jurada', () => {
  it('es obligatoria, registra evidencia y NO equivale a autorización verificada', async () => {
    const cat = await ctx.catalog();
    const d = await ctx.call('POST', '/api/requests', student, draftBody(cat, 'CERT_ESTUDIOS_POS'));
    const id = d.json.id;
    await uploadFile(ctx, student, id, 'BOLETA', 'b.pdf', 'application/pdf', PDF);
    await uploadFile(ctx, student, id, 'DNI', 'd.pdf', 'application/pdf', PDF);
    const sin = await ctx.call('POST', `/api/requests/${id}/submit`, student, {});
    expect(sin.status).toBe(422);
    const falsa = await ctx.call('POST', `/api/requests/${id}/submit`, student, { declarationAccepted: false });
    expect(falsa.status).toBe(422);
    // el usuario no puede inyectar el estado de verificación
    const hack = await ctx.call('POST', `/api/requests/${id}/submit`, student, { declarationAccepted: true, verification_status: 'verificada' });
    expect(hack.status).toBe(400);
    const ok = await ctx.call('POST', `/api/requests/${id}/submit`, student, { declarationAccepted: true });
    expect(ok.status).toBe(200);
    const row = (await ctx.db.query<any>(`SELECT * FROM declarations WHERE request_id=$1`, [id]))[0];
    expect(row.verification_status).toBe('pendiente');
    expect(row.verified_by).toBeNull();
    expect(row.text_version).toBe('v1');
    expect(row.text_snapshot).toContain('autorización de la Unidad de Posgrado');
    expect(row.accepted_at).toBeTruthy();
    // el solicitante no puede verificar
    expect((await ctx.call('POST', `/api/admin/requests/${id}/declaration/verify`, student, { status: 'verificada' })).status).toBe(403);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/declaration/verify`, reviewer, { status: 'verificada' })).status).toBe(200);
  });

  it('si la configuración exige declaration_verified, no se puede finalizar sin verificación', async () => {
    const admin = ctx.token(`admin@${DOMAIN}`);
    const types = (await ctx.call('GET', '/api/admin/tramite-types', admin)).json;
    const t = types.find((x: any) => x.code === 'CONST_EGRESADO_SEGESP');
    const upd = await ctx.call('PUT', `/api/admin/tramite-types/${t.id}`, admin, {
      name: t.name, groupLabel: t.groupLabel, description: t.description, active: true, sortOrder: t.sortOrder,
      config: { ...t.config, finalizeRequires: ['issued_document', 'declaration_verified'] },
    });
    expect(upd.status).toBe(200);
    const { id } = await createSubmitted(ctx, student, 'CONST_EGRESADO_SEGESP', {}, 'bio', { declarationAccepted: true });
    await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'start_review' });
    await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'approve' });
    const p = await ctx.call('POST', `/api/admin/requests/${id}/issued/presign`, issuer, { filename: 'c.pdf', size: PDF.length });
    await ctx.app.inject({ method: 'PUT', url: new URL(p.json.upload.url).pathname, headers: { 'content-type': 'application/pdf' }, payload: PDF });
    await ctx.call('POST', `/api/admin/requests/${id}/issued/${p.json.docId}/complete`, issuer, {});
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, issuer)).status).toBe(200);
    // Confirma recepción, pero la verificación de posgrado sigue pendiente: no se cierra todavía
    expect((await ctx.call('POST', `/api/requests/${id}/receipt`, student, { answer: 'si' })).json.status).toBe('EMITIDA');
    const f1 = await ctx.call('POST', `/api/admin/requests/${id}/finalize`, issuer);
    expect(f1.status).toBe(422);
    expect(f1.json.details.unmet[0]).toMatch(/Unidad de Posgrado/);
    await ctx.call('POST', `/api/admin/requests/${id}/declaration/verify`, reviewer, { status: 'verificada' });
    expect((await ctx.call('POST', `/api/admin/requests/${id}/finalize`, issuer)).status).toBe(200);
  });
});
