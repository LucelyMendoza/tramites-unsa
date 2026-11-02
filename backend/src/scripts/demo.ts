/**
 * Carga solicitudes FICTICIAS de demostración recorriendo el flujo real del API (presign → PUT → complete → estados).
 * Solo desarrollo. Ejecutar con el servidor DETENIDO cuando se usa PGlite en disco (PGLITE_DIR).
 *   npm run demo
 */
import { buildApp } from '../app.js';
import { DevVerifier } from '../auth/verifier.js';
import { allowedDomains, loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';
import { ConsoleProvider } from '../notifications/providers/console.js';
import { createStorage } from '../storage/index.js';
import { demoPdf, demoPng } from './demoFiles.js';
import { seedCatalogs, seedDevAssignmentRules, seedDevStaff, syncTramiteTypes } from './seedData.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production' || cfg.AUTH_MODE === 'firebase') throw new Error('demo solo se usa en desarrollo/pruebas');
if (cfg.STORAGE_DRIVER !== 'local') throw new Error('demo requiere STORAGE_DRIVER=local');
const db = await createDb(cfg);
await migrate(db);
await seedCatalogs(db);
await syncTramiteTypes(db);
const domain = allowedDomains(cfg)[0];
await seedDevStaff(db, domain);
await seedDevAssignmentRules(db, domain);
if (process.argv.includes('--reset')) {
  // Solo datos FICTICIOS de desarrollo: vacía solicitudes y su historial (catálogo y usuarios se conservan).
  await db.query(`TRUNCATE requests CASCADE`);
  await db.query(`DELETE FROM audit_log`);
  console.log('Solicitudes de prueba eliminadas (--reset).');
}
const prior = (await db.query<any>(`SELECT count(*)::int AS n FROM requests`))[0].n;
if (prior > 0 && !process.argv.includes('--force')) {
  console.log(`Ya existen ${prior} solicitudes; no se cargan demos (use --force para agregar más).`);
  await db.close();
  process.exit(0);
}
const verifier = new DevVerifier(cfg.DEV_AUTH_SECRET);
const app = await buildApp({ cfg, db, storage: createStorage(cfg), mail: new ConsoleProvider(() => {}), verifier });
await app.ready();

const PDF = demoPdf('Boleta de pago', ['Concepto: derecho de tramite', 'Monto: S/ 0.00 (prueba)', 'Operacion: 000000']);
const PNG = demoPng();
const ISSUED = (t: string) => demoPdf(t.startsWith('CERT') ? 'Certificado de estudios' : t === 'LIBRETA_NOTAS' ? 'Libreta de notas' : 'Constancia', ['Universidad Nacional de San Agustin de Arequipa', 'Direccion de Servicios Academicos', 'Emitido en el entorno de pruebas']);

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.body ? JSON.parse(res.body) : null;
  if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return json;
}
async function upload(token: string, url: string, completeUrl: (id: string) => string, body: object, ct: string, data: Buffer) {
  const p = await call('POST', url, token, body);
  const put = await app.inject({ method: 'PUT', url: new URL(p.upload.url).pathname, headers: { 'content-type': ct }, payload: data });
  if (put.statusCode !== 200) throw new Error('PUT ' + put.body);
  await call('POST', completeUrl(p.fileId ?? p.docId), token, {});
}

const T = (email: string, name: string) => verifier.sign(email, name);
const reviewer = T(`revisor@${domain}`, 'Revisor de Prueba');
const issuer = T(`emisor@${domain}`, 'Emisor de Prueba');

const PEOPLE = [
  { email: `estudiante1@${domain}`, name: 'Quispe Mamani Juan Carlos', dni: '70000001', cui: '20201001', type: 'estudiante' },
  { email: `egresado1@${domain}`, name: 'Flores Condori Pedro Luis', dni: '70000003', cui: '20151003', type: 'egresado' },
  { email: `mhuaman@${domain}`, name: 'Huaman Ccahuana Maria Elena', dni: '70000002', cui: '20201002', type: 'estudiante' },
  { email: `lrojas@${domain}`, name: 'Rojas Valdivia Lucia Andrea', dni: '70000011', cui: '20211011', type: 'estudiante' },
  { email: `dcarpio@${domain}`, name: 'Carpio Zegarra Diego Alonso', dni: '70000012', cui: '20181012', type: 'egresado' },
  { email: `ssalas@${domain}`, name: 'Salas Pinto Sofia Valentina', dni: '70000013', cui: '20221013', type: 'estudiante' },
];
type Target = 'ENVIADA' | 'EN_REVISION' | 'REQUIERE_SUBSANACION' | 'REENVIADA' | 'EN_TRAMITE' | 'EMITIDA' | 'FINALIZADA';
const PLAN: [number, string, Target][] = [
  [0, 'CERT_ESTUDIOS_PRE', 'FINALIZADA'], [1, 'CONST_EGRESADO_PRE', 'FINALIZADA'], [2, 'LIBRETA_NOTAS', 'EMITIDA'],
  [3, 'CONST_PRIMERA_MAT_PRE', 'EN_TRAMITE'], [4, 'CONST_EGRESADO_POS', 'EN_TRAMITE'], [5, 'LIBRETA_NOTAS', 'REENVIADA'],
  [0, 'CONST_RANKING_2025', 'REQUIERE_SUBSANACION'], [3, 'LIBRETA_NOTAS', 'REQUIERE_SUBSANACION'],
  [1, 'CONDICION_EGRESO_BACH', 'EN_REVISION'], [2, 'CERT_ESTUDIOS_PRE', 'EN_REVISION'],
  [4, 'CERT_ESTUDIOS_POS', 'ENVIADA'], [5, 'CONST_NO_ADEUDO_BIB', 'ENVIADA'], [2, 'MULTA_NO_VOTAR', 'ENVIADA'], [3, 'ACTUALIZACION_FOTO', 'ENVIADA'],
];
/** Datos del trámite según los campos configurados (boletas únicas, años académicos). */
const typeDataFor = (type: any, i: number) =>
  Object.fromEntries(
    (type.fields ?? []).map((f: any) => [
      f.key,
      f.type === 'receipt' ? `B001-${String(100 + i).padStart(6, '0')}` : f.type === 'multi-select' ? f.options.slice(0, 2) : f.type === 'select' ? f.options[0] : 'Dato de prueba',
    ]),
  );

const cat = await call('GET', '/api/catalog', T(PEOPLE[0].email, PEOPLE[0].name));
const schools = cat.schools as any[];
let ok = 0;
for (const [i, [pi, typeCode, target]] of PLAN.entries()) {
  const p = PEOPLE[pi];
  const tok = T(p.email, p.name);
  const type = cat.tramiteTypes.find((t: any) => t.code === typeCode);
  if (!type) { console.warn('Tipo no encontrado en el catálogo:', typeCode); continue; }
  const school = schools[i % schools.length];
  try {
    const d = await call('POST', '/api/requests', tok, {
      applicantType: p.type, apellidosNombres: p.name, dni: p.dni, cui: p.cui,
      typeData: typeDataFor(type, i),
      facultyId: school.facultyId, schoolId: school.id, programId: null, tramiteTypeId: type.id,
    });
    const id = d.id;
    const files = (u: string) => `/api/requests/${id}/files/${u}/complete`;
    await upload(tok, `/api/requests/${id}/files/presign`, files, { slot: 'BOLETA', filename: 'boleta-pago.pdf', size: PDF.length, contentType: 'application/pdf' }, 'application/pdf', PDF);
    await upload(tok, `/api/requests/${id}/files/presign`, files, { slot: 'DNI', filename: 'dni.png', size: PNG.length, contentType: 'image/png' }, 'image/png', PNG);
    await call('POST', `/api/requests/${id}/submit`, tok, type.requiresDeclaration ? { declarationAccepted: true } : {});
    const review = (body: object) => call('POST', `/api/admin/requests/${id}/review`, reviewer, body);
    if (target !== 'ENVIADA') await review({ action: 'start_review' });
    if (target === 'REQUIERE_SUBSANACION' || target === 'REENVIADA')
      await review({ action: 'request_correction', reason: 'La imagen del DNI está borrosa; adjunte una copia legible por ambas caras.', targets: [{ type: 'file', key: 'DNI' }] });
    if (target === 'REENVIADA') {
      await upload(tok, `/api/requests/${id}/files/presign`, files, { slot: 'DNI', filename: 'dni-legible.png', size: PNG.length, contentType: 'image/png' }, 'image/png', PNG);
      await call('POST', `/api/requests/${id}/submit`, tok, {});
    }
    if (['EN_TRAMITE', 'EMITIDA', 'FINALIZADA'].includes(target)) await review({ action: 'approve' });
