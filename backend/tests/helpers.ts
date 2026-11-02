import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DevVerifier } from '../src/auth/verifier.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, migrate, type Db } from '../src/db/index.js';
import { ConsoleProvider } from '../src/notifications/providers/console.js';
import { seedCatalogs, seedDevStaff } from '../src/scripts/seedData.js';
import { LocalStorage } from '../src/storage/index.js';

export const DOMAIN = 'unsa.edu.pe';
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
export const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

export interface Ctx {
  app: FastifyInstance;
  db: Db;
  cfg: Config;
  mail: ConsoleProvider;
  storage: LocalStorage;
  verifier: DevVerifier;
  token(email: string, name?: string): string;
  call(method: string, url: string, token?: string, body?: unknown): Promise<{ status: number; json: any; raw: string; headers: any }>;
  catalog(): Promise<any>;
  close(): Promise<void>;
}

export async function makeCtx(env: Record<string, string> = {}): Promise<Ctx> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    ALLOWED_EMAIL_DOMAINS: DOMAIN,
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'tramites-')),
    DEV_AUTH_SECRET: 'test-secret',
    ...env,
  } as any);
  const db = await createDb(cfg);
  await migrate(db);
  await seedCatalogs(db);
  await seedDevStaff(db, DOMAIN);
  const mail = new ConsoleProvider(() => {});
  const storage = new LocalStorage(cfg.LOCAL_STORAGE_DIR, cfg.PUBLIC_API_URL, cfg.DEV_AUTH_SECRET);
  const verifier = new DevVerifier(cfg.DEV_AUTH_SECRET);
  const app = await buildApp({ cfg, db, storage, mail, verifier });
  await app.ready();
  const call: Ctx['call'] = async (method, url, token, body) => {
    const isBuf = Buffer.isBuffer(body);
    const res = await app.inject({
      method: method as any,
      url,
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body && !isBuf ? { 'content-type': 'application/json' } : {}),
      },
      payload: body === undefined ? undefined : isBuf ? body : JSON.stringify(body),
    });
    let json: any = null;
    try {
      json = JSON.parse(res.body);
    } catch {}
    return { status: res.statusCode, json, raw: res.body, headers: res.headers };
  };
  return {
    app,
    db,
    cfg,
    mail,
    storage,
    verifier,
    token: (email, name = 'Usuario Prueba') => verifier.sign(email, name),
    call,
    catalog: async () => (await call('GET', '/api/catalog', verifier.sign(`estudiante1@${DOMAIN}`, 'E'))).json,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** Selecciona facultad/escuela/tipo del catálogo ficticio. */
export function pick(cat: any, typeCode: string, school: 'bio' | 'sis' = 'bio') {
  const schoolRow = cat.schools.find((s: any) => s.code === (school === 'bio' ? 'CBI-BIO' : 'IPS-SIS'));
  const program = cat.programs.find((p: any) => p.schoolId === schoolRow.id);
  return {
    facultyId: schoolRow.facultyId,
    schoolId: schoolRow.id,
    programId: program?.id ?? null,
    tramiteTypeId: cat.tramiteTypes.find((t: any) => t.code === typeCode).id,
  };
}

export function draftBody(cat: any, typeCode = 'CONST_EGRESADO_PRE', over: Record<string, unknown> = {}, school: 'bio' | 'sis' = 'bio') {
  return {
    applicantType: 'estudiante',
    apellidosNombres: 'Quispe Mamani Juan Carlos',
    dni: '70000001',
    cui: '20201001',
    typeData: {},
    ...pick(cat, typeCode, school),
    ...over,
  };
}

/** Sube un archivo como lo haría el navegador: presign → PUT directo al almacenamiento → complete. */
export async function uploadFile(
  ctx: Ctx,
  token: string,
  requestId: string,
  slot: string,
  filename: string,
  contentType: string,
  data: Buffer,
  opts: { declaredSize?: number } = {},
) {
  const p = await ctx.call('POST', `/api/requests/${requestId}/files/presign`, token, {
    slot,
    filename,
    size: opts.declaredSize ?? data.length,
    contentType,
  });
  if (p.status !== 200) return { presign: p, complete: null as any };
  const path = new URL(p.json.upload.url).pathname;
  const put = await ctx.app.inject({ method: 'PUT', url: path, headers: { 'content-type': contentType }, payload: data });
  if (put.statusCode !== 200) return { presign: p, put, complete: null as any };
  const c = await ctx.call('POST', `/api/requests/${requestId}/files/${p.json.fileId}/complete`, token, {});
  return { presign: p, put, complete: c, fileId: p.json.fileId as string };
}

export async function createSubmitted(ctx: Ctx, token: string, typeCode = 'CONST_EGRESADO_PRE', over: Record<string, unknown> = {}, school: 'bio' | 'sis' = 'bio', submitBody: object = {}) {
  const cat = await ctx.catalog();
  const d = await ctx.call('POST', '/api/requests', token, draftBody(cat, typeCode, over, school));
  if (d.status !== 201) throw new Error('draft: ' + d.raw);
  const id = d.json.id as string;
  const a = await uploadFile(ctx, token, id, 'BOLETA', 'boleta.pdf', 'application/pdf', PDF);
  const b = await uploadFile(ctx, token, id, 'DNI', 'dni.png', 'image/png', PNG);
  if (a.complete?.status !== 200 || b.complete?.status !== 200) throw new Error('upload failed');
  const s = await ctx.call('POST', `/api/requests/${id}/submit`, token, submitBody);
  return { id, submit: s };
}
