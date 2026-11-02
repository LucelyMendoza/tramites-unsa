import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AuthError, assertAllowedIdentity, type TokenVerifier, DevVerifier } from './auth/verifier.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { createDirectory, type DirectoryProvider } from './domain/directory.js';
import { HttpError } from './errors.js';
import { adminRoutes } from './modules/admin.js';
import { applicantRoutes } from './modules/applicant.js';
import { assignmentRoutes } from './modules/assignments.js';
import { reportRoutes } from './modules/reports.js';
import { metaRoutes } from './modules/meta.js';
import type { AuthUser } from './modules/service.js';
import type { ConsoleProvider } from './notifications/providers/console.js';
import type { MailProvider } from './notifications/providers/types.js';
import { LocalStorage, type Storage } from './storage/index.js';

export interface Deps {
  cfg: Config;
  db: Db;
  storage: Storage;
  mail: MailProvider;
  verifier: TokenVerifier;
  directory?: DirectoryProvider;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const PUBLIC_PREFIXES = ['/api/health', '/api/public-config', '/api/dev/', '/api/_local-storage/'];

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { cfg, db } = deps;
  const app = Fastify({ logger: cfg.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization'] }, bodyLimit: Math.max(1, cfg.MAX_FILE_MB) * 1024 * 1024 + 1024, routerOptions: { maxParamLength: 512 } });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: () => cfg.NODE_ENV === 'test',
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });

  // Cargas directas del driver local (solo desarrollo): cuerpo binario crudo.
  for (const ct of ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream']) {
    app.addContentTypeParser(ct, { parseAs: 'buffer', bodyLimit: 30 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  }

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError)
      return reply.status(400).send({
        error: 'Datos inválidos',
        details: Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message])),
      });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Error interno' });
  });

  // ---- Autenticación + identidad + rol (siempre desde la base de datos del backend) ----
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return;
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AuthError('Falta el token de autenticación');
    const identity = await deps.verifier.verify(h.slice(7));
    assertAllowedIdentity(identity, cfg);
    const u = (
      await db.query<any>(
        `INSERT INTO users(email,display_name,firebase_uid,last_login_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (email) DO UPDATE SET last_login_at=now(),
           display_name=CASE WHEN EXCLUDED.display_name<>'' THEN EXCLUDED.display_name ELSE users.display_name END,
           firebase_uid=COALESCE(users.firebase_uid, EXCLUDED.firebase_uid)
         RETURNING *`,
        [identity.email, identity.name, identity.uid],
      )
    )[0];
    const s = (await db.query<any>(`SELECT role,faculty_scope FROM staff_roles WHERE user_id=$1 AND active`, [u.id]))[0];
    req.user = {
      id: u.id,
      email: u.email,
      name: u.display_name,
      applicantType: u.applicant_type,
      staff: s ? { role: s.role, scope: s.faculty_scope ?? null } : undefined,
    };
  });

  // ---- Driver local de almacenamiento (solo desarrollo) ----
  if (deps.storage instanceof LocalStorage) {
    const local = deps.storage;
    app.put('/api/_local-storage/:token', async (req, reply) => {
      const v = local.verifyToken((req.params as any).token, 'put');
      if (!v) return reply.status(403).send({ error: 'URL expirada o inválida' });
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length !== Number(v.extra)) return reply.status(400).send({ error: 'Tamaño distinto al declarado' });
      await local.put(v.key, body);
      return reply.status(200).send({ ok: true });
    });
    app.get('/api/_local-storage/:token', async (req, reply) => {
      const v = local.verifyToken((req.params as any).token, 'get');
      if (!v) return reply.status(403).send({ error: 'URL expirada o inválida' });
      const meta = JSON.parse(Buffer.from(v.extra, 'base64url').toString());
      const data = await local.read(v.key, 30 * 1024 * 1024);
      return reply
        .header('Content-Type', meta.contentType)
        .header('Content-Disposition', `${meta.disposition === 'inline' ? 'inline' : 'attachment'}; filename="${String(meta.filename).replace(/[^\w.\- ]+/g, '_')}"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(data);
    });
  }

  const directory = deps.directory ?? createDirectory(cfg);
  await app.register(metaRoutes, { ...deps, directory });
  await app.register(applicantRoutes, { ...deps, directory });
  await app.register(adminRoutes, { ...deps, directory });
  await app.register(assignmentRoutes, { ...deps, directory });
  await app.register(reportRoutes, { ...deps, directory });
  return app;
}

export function devVerifier(cfg: Config) {
  return new DevVerifier(cfg.DEV_AUTH_SECRET);
}

export type ConsoleMail = ConsoleProvider;
