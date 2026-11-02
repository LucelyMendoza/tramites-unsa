import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN, PDF, PNG, createSubmitted, draftBody, makeCtx, uploadFile, type Ctx } from './helpers.js';

let ctx: Ctx;
let s1: string, s2: string, reviewer: string, issuer: string, admin: string;
beforeAll(async () => {
  ctx = await makeCtx();
  s1 = ctx.token(`estudiante1@${DOMAIN}`, 'E Uno');
  s2 = ctx.token(`estudiante2@${DOMAIN}`, 'E Dos');
  reviewer = ctx.token(`revisor@${DOMAIN}`);
  issuer = ctx.token(`emisor@${DOMAIN}`);
  admin = ctx.token(`admin@${DOMAIN}`);
});
afterAll(() => ctx.close());

describe('autenticación', () => {
  it('sin token → 401', async () => {
    expect((await ctx.call('GET', '/api/me')).status).toBe(401);
    expect((await ctx.call('GET', '/api/requests')).status).toBe(401);
  });
  it('token manipulado → 401', async () => {
    expect((await ctx.call('GET', '/api/me', ctx.token(`a@${DOMAIN}`) + 'x')).status).toBe(401);
  });
  it('dominio no permitido → 403', async () => {
    const r = await ctx.call('GET', '/api/me', ctx.token('intruso@gmail.com'));
    expect([401, 403]).toContain(r.status);
  });
  it('un estudiante no accede al panel admin', async () => {
    expect((await ctx.call('GET', '/api/admin/requests', s1)).status).toBe(403);
    expect((await ctx.call('GET', '/api/admin/stats', s1)).status).toBe(403);
  });
});

describe('escalada de roles', () => {
  it('PATCH /api/me no permite asignarse rol', async () => {
    const r = await ctx.call('PATCH', '/api/me', s1, { role: 'superadmin', applicantType: 'egresado' });
    expect(r.status).toBe(400);
    const me = await ctx.call('GET', '/api/me', s1);
    expect(me.json.staff ?? null).toBeNull();
  });
  it('el revisor no puede gestionar catálogo ni personal', async () => {
    expect((await ctx.call('PUT', '/api/admin/tramite-types/x', reviewer, {})).status).toBeGreaterThanOrEqual(400);
    expect((await ctx.call('GET', '/api/admin/staff', reviewer)).status).toBe(403);
  });
  it('un usuario nuevo con dominio válido siempre es solicitante', async () => {
    const me = await ctx.call('GET', '/api/me', ctx.token(`nuevo@${DOMAIN}`));
    expect(me.status).toBe(200);
    expect(me.json.staff ?? null).toBeNull();
  });
});

describe('propiedad de solicitudes y archivos', () => {
  let id: string;
  beforeAll(async () => {
    id = (await createSubmitted(ctx, s1)).id;
  });
  it('otro estudiante recibe 404 (no revela existencia)', async () => {
    expect((await ctx.call('GET', `/api/requests/${id}`, s2)).status).toBe(404);
    expect((await ctx.call('POST', `/api/requests/${id}/files/presign`, s2, { slot: 'DNI', filename: 'a.png', size: 10, contentType: 'image/png' })).status).toBe(404);
  });
  it('el listado propio no incluye ajenas', async () => {
    const l = await ctx.call('GET', '/api/requests', s2);
    expect(JSON.stringify(l.json)).not.toContain(id);
  });
  it('URL de descarga: solo dueño o personal con alcance, y es de corta vida', async () => {
    const d = await ctx.call('GET', `/api/requests/${id}`, s1);
    const f = d.json.files.find((x: any) => x.slot === 'DNI' && x.isCurrent);
    expect((await ctx.call('GET', `/api/files/${f.id}/download-url`, s2)).status).toBe(404);
    const ok = await ctx.call('GET', `/api/files/${f.id}/download-url`, s1);
    expect(ok.status).toBe(200);
    expect(ok.json.expiresInSeconds).toBeLessThanOrEqual(60);
    expect(ok.json.url).toContain('/api/_local-storage/');
  });
  it('vista previa (inline) y descarga (attachment) se distinguen en cabeceras y auditoría', async () => {
    const d = await ctx.call('GET', `/api/requests/${id}`, s1);
    const f = d.json.files.find((x: any) => x.slot === 'DNI' && x.isCurrent);
    expect((await ctx.call('GET', `/api/files/${f.id}/download-url?mode=ejecutar`, s1)).status).toBe(400);
    const view = await ctx.call('GET', `/api/files/${f.id}/download-url?mode=inline`, s1);
    expect(view.status).toBe(200);
    expect(view.json.mode).toBe('inline');
    expect(view.json.contentType).toBe('image/png');
    const vr = await ctx.app.inject({ method: 'GET', url: new URL(view.json.url).pathname });
    expect(vr.statusCode).toBe(200);
    expect(vr.headers['content-disposition']).toMatch(/^inline;/);
    expect(vr.headers['x-content-type-options']).toBe('nosniff');
    const dl = await ctx.call('GET', `/api/files/${f.id}/download-url`, s1);
    const dr = await ctx.app.inject({ method: 'GET', url: new URL(dl.json.url).pathname });
    expect(dr.headers['content-disposition']).toMatch(/^attachment;/);
    const acts = (await ctx.db.query<any>(`SELECT action FROM audit_log WHERE entity_id=$1`, [id])).map((a) => a.action);
    expect(acts).toContain('file.view');
    expect(acts).toContain('file.download');
  });
  it('claves de objeto impredecibles y sin datos personales', async () => {
    const keys = await ctx.db.query<any>(`SELECT object_key FROM request_files WHERE request_id=$1`, [id]);
    for (const k of keys) {
      expect(k.object_key).toMatch(/^att\/[A-Za-z0-9_-]{30,}$/);
      expect(k.object_key).not.toContain('70000001');
    }
  });
  it('no se puede modificar una solicitud ya enviada (adjuntos)', async () => {
    const r = await uploadFile(ctx, s1, id, 'DNI', 'x.png', 'image/png', PNG);
    expect(r.presign.status).toBeGreaterThanOrEqual(400);
  });
});

describe('alcance por facultad', () => {
  it('un revisor limitado a una facultad no ve ni abre solicitudes de otra', async () => {
    const cat = await ctx.catalog();
    const fcp = cat.faculties.find((f: any) => f.code === 'CBI').id;
    await ctx.db.query(
      `INSERT INTO users(email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [`revisor.fcp@${DOMAIN}`]);
    await ctx.db.query(
      `INSERT INTO staff_roles(user_id,role,faculty_scope,granted_by) SELECT id,'reviewer',$2::jsonb,'test' FROM users WHERE email=$1`,
      [`revisor.fcp@${DOMAIN}`, JSON.stringify([fcp])],
    );
    const scoped = ctx.token(`revisor.fcp@${DOMAIN}`);
    const a = await createSubmitted(ctx, s1, 'CONST_EGRESADO_PRE', {}, 'bio');
    const b = await createSubmitted(ctx, s2, 'CONST_EGRESADO_PRE', { dni: '70000002' }, 'sis');
    const list = await ctx.call('GET', '/api/admin/requests?pageSize=100', scoped);
    const ids = list.json.items.map((x: any) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect((await ctx.call('GET', `/api/admin/requests/${b.id}`, scoped)).status).toBe(404);
    expect((await ctx.call('POST', `/api/admin/requests/${b.id}/review`, scoped, { action: 'start_review' })).status).toBe(404);
    const all = await ctx.call('GET', '/api/admin/requests?pageSize=100', reviewer);
    expect(all.json.items.map((x: any) => x.id)).toContain(b.id);
  });
});

describe('archivos: validación de contenido', () => {
  let id: string;
  beforeAll(async () => {
    const cat = await ctx.catalog();
    id = (await ctx.call('POST', '/api/requests', s1, draftBody(cat))).json.id;
  });
  it('rechaza extensión/tipo no permitido', async () => {
    const r = await uploadFile(ctx, s1, id, 'DNI', 'x.exe', 'application/x-msdownload', Buffer.from('MZ'));
    expect(r.presign.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza archivo cuyo contenido real no coincide (EXE renombrado a .pdf)', async () => {
    const r = await uploadFile(ctx, s1, id, 'BOLETA', 'boleta.pdf', 'application/pdf', Buffer.from('MZ\x90\x00' + 'x'.repeat(100)));
    expect(r.complete.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza PNG declarado como PDF', async () => {
    const r = await uploadFile(ctx, s1, id, 'BOLETA', 'boleta.pdf', 'application/pdf', PNG);
    expect(r.complete.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza PDF con JavaScript embebido', async () => {
    const evil = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF\n');
    const r = await uploadFile(ctx, s1, id, 'BOLETA', 'boleta.pdf', 'application/pdf', evil);
    expect(r.complete.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza tamaño declarado excesivo', async () => {
    const p = await ctx.call('POST', `/api/requests/${id}/files/presign`, s1, { slot: 'DNI', filename: 'a.png', size: 50 * 1024 * 1024, contentType: 'image/png' });
    expect(p.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza archivo vacío', async () => {
    const p = await ctx.call('POST', `/api/requests/${id}/files/presign`, s1, { slot: 'DNI', filename: 'a.png', size: 0, contentType: 'image/png' });
    expect(p.status).toBeGreaterThanOrEqual(400);
  });
  it('rechaza slot inexistente', async () => {
    const p = await ctx.call('POST', `/api/requests/${id}/files/presign`, s1, { slot: 'OTRO', filename: 'a.png', size: 10, contentType: 'image/png' });
    expect(p.status).toBeGreaterThanOrEqual(400);
  });
  it('no permite enviar sin los adjuntos obligatorios', async () => {
    const r = await ctx.call('POST', `/api/requests/${id}/submit`, s1, {});
    expect(r.status).toBe(422);
  });
  it('URL local con firma alterada es rechazada', async () => {
    const p = await ctx.call('POST', `/api/requests/${id}/files/presign`, s1, { slot: 'DNI', filename: 'a.png', size: PNG.length, contentType: 'image/png' });
    const path = new URL(p.json.upload.url).pathname;
    const put = await ctx.app.inject({ method: 'PUT', url: path.slice(0, -2) + 'AA', headers: { 'content-type': 'image/png' }, payload: PNG });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('validación de datos del formulario', () => {
  let cat: any;
  beforeAll(async () => (cat = await ctx.catalog()));
  const post = (over: Record<string, unknown>, type = 'CONST_EGRESADO_PRE') => ctx.call('POST', '/api/requests', s1, draftBody(cat, type, over));
  it('DNI inválido', async () => {
    for (const dni of ['1234567', '123456789', 'abcdefgh', '']) expect((await post({ dni })).status).toBeGreaterThanOrEqual(400);
  });
  it('el nombre sale de la cuenta institucional, no de lo que envía el navegador', async () => {
    const r = await post({ apellidosNombres: 'Nombre Inventado Por El Navegador' });
    expect(r.status).toBe(201);
    const d = (await ctx.call('GET', `/api/requests/${r.json.id}`, s1)).json;
    expect(d.apellidosNombres).toBe('E Uno');
  });
  it('sin nombre en la cuenta, el nombre escrito es obligatorio', async () => {
    const anon = ctx.token(`sinnombre@${DOMAIN}`, '');
    expect((await ctx.call('POST', '/api/requests', anon, draftBody(cat, 'CONST_EGRESADO_PRE', { apellidosNombres: '' }))).status).toBeGreaterThanOrEqual(400);
  });
  it('CUI según patrón configurable', async () => {
    expect((await post({ cui: 'AB-12' })).status).toBeGreaterThanOrEqual(400);
  });
  it('un tipo sin campos rechaza campos adicionales', async () => {
    expect((await post({ typeData: { aniosAcademicos: ['1°'] } })).status).toBeGreaterThanOrEqual(400);
  });
  it('Certificado de estudios exige años académicos 1°…7°', async () => {
    expect((await post({ typeData: {} }, 'CERT_ESTUDIOS_PRE')).status).toBeGreaterThanOrEqual(400);
    expect((await post({ typeData: { aniosAcademicos: ['9°'] } }, 'CERT_ESTUDIOS_PRE')).status).toBeGreaterThanOrEqual(400);
    expect((await post({ typeData: { aniosAcademicos: [2022] } }, 'CERT_ESTUDIOS_PRE')).status).toBeGreaterThanOrEqual(400);
    const ok = await post({ typeData: { aniosAcademicos: ['3°', '1°', '1°'] } }, 'CERT_ESTUDIOS_PRE');
    expect(ok.status).toBe(201);
    const d = await ctx.call('GET', `/api/requests/${ok.json.id}`, s1);
    expect(d.json.typeData.aniosAcademicos).toEqual(['1°', '3°']);
  });
  it('el catálogo ya no ofrece programas académicos', async () => {
    expect(cat.programs).toEqual([]);
  });
  it('escuela que no pertenece a la facultad', async () => {
    const other = cat.schools.find((x: any) => x.code === 'IPS-SIS');
    const bio = cat.schools.find((x: any) => x.code === 'CBI-BIO');
    expect((await post({ facultyId: bio.facultyId, schoolId: other.id, programId: null })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('transiciones y exportación', () => {
  it('transiciones inválidas → 409', async () => {
    const { id } = await createSubmitted(ctx, s1);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/review`, reviewer, { action: 'approve' })).status).toBe(409);
    expect((await ctx.call('POST', `/api/admin/requests/${id}/emit`, issuer)).status).toBeGreaterThanOrEqual(400);
  });
  it('paginación acotada en backend', async () => {
    const r = await ctx.call('GET', '/api/admin/requests?pageSize=2&page=1', reviewer);
    expect(r.json.items.length).toBeLessThanOrEqual(2);
    expect(r.json.total).toBeGreaterThanOrEqual(r.json.items.length);
    expect((await ctx.call('GET', '/api/admin/requests?pageSize=5000', reviewer)).status).toBe(400);
  });
  it('búsqueda por código, DNI y nombre', async () => {
    const zeta = ctx.token(`zeta@${DOMAIN}`, 'Zeta Unico Apellido');
    const { id, submit } = await createSubmitted(ctx, zeta, 'CONST_EGRESADO_PRE', { dni: '71234567' }, 'sis');
    for (const q of [submit.json.code, '71234567', 'Zeta Unico']) {
      const r = await ctx.call('GET', `/api/admin/requests?q=${encodeURIComponent(q)}`, reviewer);
      expect(r.json.items.map((x: any) => x.id)).toContain(id);
    }
  });
  it('CSV: solo personal autorizado y sin DNI/CUI/nombre', async () => {
    expect((await ctx.call('GET', '/api/admin/requests/export.csv', s1)).status).toBe(403);
    const r = await ctx.call('GET', '/api/admin/requests/export.csv', admin);
    expect(r.status).toBe(200);
    expect(r.raw).toContain('codigo');
    expect(r.raw).not.toMatch(/7\d{7}/);
    expect(r.raw).not.toContain('Quispe');
    expect(r.headers['content-type']).toContain('text/csv');
    const a = await ctx.db.query<any>(`SELECT 1 FROM audit_log WHERE action='report.export'`);
    expect(a.length).toBeGreaterThan(0);
  });
  it('cabeceras de seguridad presentes', async () => {
    const r = await ctx.call('GET', '/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Libreta de notas: número de boleta obligatorio y único', () => {
  let cat: any;
  beforeAll(async () => (cat = await ctx.catalog()));
  const draft = (tok: string, numeroBoleta?: string, over: Record<string, unknown> = {}) =>
    ctx.call('POST', '/api/requests', tok, draftBody(cat, 'LIBRETA_NOTAS', { typeData: numeroBoleta === undefined ? {} : { numeroBoleta }, ...over }));

  it('es obligatorio y valida el formato', async () => {
    const sin = await draft(s1);
    expect(sin.status).toBe(422);
    expect(sin.json.details['typeData.numeroBoleta']).toBeTruthy();
    expect((await draft(s1, '##')).status).toBe(422);
  });

  it('el mismo alumno no puede reutilizar su boleta en otro trámite (ni con otro formato)', async () => {
    const a = await draft(s1, 'B001-000777');
    expect(a.status).toBe(201);
    const b = await draft(s1, 'b001 000777');
    expect(b.status).toBe(422);
    expect(b.json.details['typeData.numeroBoleta']).toMatch(/Ya usó este número de boleta/);
  });

  it('otro alumno tampoco puede usarla, y no se le revela de quién es', async () => {
    const r = await draft(s2, 'B001000777', { dni: '70000002' });
    expect(r.status).toBe(422);
    expect(r.json.details['typeData.numeroBoleta']).toMatch(/ya fue registrado en otra solicitud/);
    expect(JSON.stringify(r.json)).not.toMatch(/TD-\d{4}/);
  });

  it('editar la propia solicitud conservando su boleta está permitido; cambiarla a una usada no', async () => {
    const mine = await draft(s1, 'B002-000001');
    expect(mine.status).toBe(201);
    const same = await ctx.call('PUT', `/api/requests/${mine.json.id}`, s1, draftBody(cat, 'LIBRETA_NOTAS', { typeData: { numeroBoleta: 'B002-000001' } }));
    expect(same.status).toBe(200);
    const taken = await ctx.call('PUT', `/api/requests/${mine.json.id}`, s1, draftBody(cat, 'LIBRETA_NOTAS', { typeData: { numeroBoleta: 'B001-000777' } }));
    expect(taken.status).toBe(422);
  });

  it('la base de datos impide el duplicado aunque se salte la validación (índice único)', async () => {
    const [r] = await ctx.db.query<any>(`SELECT id FROM requests WHERE receipt_norm='B001000777'`);
    expect(r).toBeTruthy();
    await expect(ctx.db.query(`UPDATE requests SET receipt_norm='B001000777' WHERE id<>$1 AND receipt_norm IS NULL`, [r.id])).rejects.toThrow();
  });
});
