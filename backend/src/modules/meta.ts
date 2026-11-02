import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { devVerifierOf } from '../auth/verifier.js';
import { allowedDomains, googleEnabled, testAccountsEnabled } from '../config.js';
import { permissionsOf } from '../domain/permissions.js';
import { parseConfig } from '../domain/tramiteConfig.js';
import { forbidden, notFound } from '../errors.js';
import { ConsoleProvider } from '../notifications/providers/console.js';
import type { Deps } from '../app.js';
import { audit, requireStaff } from './service.js';

export const DEV_ACCOUNTS = (domain: string) => [
  { email: `estudiante1@${domain}`, name: 'Estudiante de Prueba Uno', kind: 'Estudiante (prueba)' },
  { email: `egresado1@${domain}`, name: 'Egresado de Prueba Uno', kind: 'Egresado (prueba)' },
  { email: `revisor@${domain}`, name: 'Revisor de Prueba', kind: 'Administrador: revisor' },
  { email: `revisor.posgrado@${domain}`, name: 'Revisora de Posgrado (Prueba)', kind: 'Administrador: revisor posgrado' },
  { email: `emisor@${domain}`, name: 'Emisor de Prueba', kind: 'Administrador: emisor' },
  { email: `admin@${domain}`, name: 'Superadmin de Prueba', kind: 'Administrador: superadmin' },
];

export const metaRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const { cfg, db } = deps;

  app.get('/api/health', async () => ({ ok: true, db: deps.db.kind, storage: deps.storage.driver, mail: deps.mail.name, authMode: cfg.AUTH_MODE }));

  app.get('/api/public-config', async () => ({
    authMode: cfg.AUTH_MODE,
    allowedDomains: allowedDomains(cfg),
    maxFileMb: cfg.MAX_FILE_MB,
    environment: cfg.NODE_ENV,
    storageDriver: deps.storage.driver,
    mailProvider: deps.mail.name,
    testMode: cfg.AUTH_MODE !== 'firebase',
    googleEnabled: googleEnabled(cfg),
    testAccounts: testAccountsEnabled(cfg),
  }));

  // ---- Solo desarrollo/pruebas: cuentas de prueba (NO existe cuando AUTH_MODE=firebase) ----
  const devV = devVerifierOf(deps.verifier);
  if (cfg.AUTH_MODE !== 'firebase' && cfg.NODE_ENV !== 'production' && devV) {
    const verifier = devV;
    const accounts = DEV_ACCOUNTS(allowedDomains(cfg)[0]);
    app.get('/api/dev/accounts', async () => accounts);
    app.post('/api/dev/login', async (req) => {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      const acc = accounts.find((a) => a.email === email.toLowerCase());
      if (!cfg.DEV_TEST_ACCOUNTS_ENABLED || !acc) throw forbidden('Cuenta de prueba no configurada');
      return { token: verifier.sign(acc.email, acc.name), account: acc };
    });
    if (deps.mail instanceof ConsoleProvider) {
      const mail = deps.mail;
      app.get('/api/dev/mailbox', async () => mail.sent.slice(-50).reverse());
    }
  }

  app.get('/api/me', async (req) => {
    const u = req.user!;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      applicantType: u.applicantType,
      staff: u.staff ? { role: u.staff.role, scope: u.staff.scope, permissions: permissionsOf(u.staff.role) } : null,
    };
  });

  // El usuario solo puede elegir entre estudiante/egresado. El rol administrativo NO es modificable aquí.
  app.patch('/api/me', async (req) => {
    const body = z.object({ applicantType: z.enum(['estudiante', 'egresado']) }).strict().parse(req.body);
    await db.query(`UPDATE users SET applicant_type=$2 WHERE id=$1`, [req.user!.id, body.applicantType]);
    return { ok: true };
  });

  app.get('/api/me/notifications', async (req) => {
    const rows = await db.query<any>(
      `SELECT n.id,n.event,n.status,n.created_at,n.sent_at,r.code,r.id AS request_id
         FROM notifications n LEFT JOIN requests r ON r.id=n.request_id
        WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100`,
      [req.user!.id],
    );
    return rows.map((n) => ({ id: n.id, event: n.event, status: n.status === 'dead' ? 'fallida' : n.status === 'sent' ? 'enviada' : 'pendiente', createdAt: n.created_at, sentAt: n.sent_at, code: n.code, requestId: n.request_id }));
  });

  // Catálogo para formularios (solo elementos activos).
  app.get('/api/catalog', async () => {
    const [faculties, schools, programs, types] = await Promise.all([
      db.query<any>(`SELECT id,code,name FROM faculties WHERE active ORDER BY name`),
      db.query<any>(`SELECT id,faculty_id,code,name FROM schools WHERE active ORDER BY name`),
      db.query<any>(`SELECT id,school_id,name FROM programs WHERE active ORDER BY name`),
      db.query<any>(`SELECT id,code,name,group_label,description,sort_order,config,version FROM tramite_types WHERE active ORDER BY sort_order,name`),
    ]);
    return {
      faculties,
      schools: schools.map((s) => ({ id: s.id, facultyId: s.faculty_id, code: s.code, name: s.name })),
      programs: programs.map((p) => ({ id: p.id, schoolId: p.school_id, name: p.name })),
      tramiteTypes: types.map((t) => {
        const c = parseConfig(t.config);
        return {
          id: t.id,
          code: t.code,
          name: t.name,
          group: t.group_label,
          description: t.description,
          version: t.version,
          requiredDocs: c.requiredDocs,
          fields: c.fields,
          requiresDeclaration: c.requiresDeclaration,
          declarationText: c.requiresDeclaration ? 'Declaro que cuento con la autorización de la Unidad de Posgrado correspondiente para realizar este trámite' : undefined,
        };
      }),
    };
  });

  // ---- Auditoría y personal (solo lectura) ----
  app.get('/api/admin/audit', async (req) => {
    requireStaff(req.user!, 'audit:view');
    const q = z.object({ entity: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().max(200).default(100) }).parse(req.query);
    return db.query<any>(
      `SELECT id,actor_email,action,entity,entity_id,meta,created_at FROM audit_log
        WHERE ($1::text IS NULL OR entity=$1) AND ($2::text IS NULL OR entity_id=$2) ORDER BY id DESC LIMIT $3`,
      [q.entity ?? null, q.entityId ?? null, q.limit],
    );
  });

  app.get('/api/admin/staff', async (req) => {
    requireStaff(req.user!, 'staff:view');
    const rows = await db.query<any>(
      `SELECT u.id,u.email,u.display_name,s.role,s.faculty_scope,s.active,s.granted_by,s.granted_at
         FROM staff_roles s JOIN users u ON u.id=s.user_id ORDER BY u.email`,
    );
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.display_name, role: r.role, scope: r.faculty_scope, active: r.active, grantedBy: r.granted_by, grantedAt: r.granted_at }));
  });

  app.get('/api/admin/notifications', async (req) => {
    requireStaff(req.user!, 'audit:view');
    const q = z.object({ status: z.enum(['pending', 'sending', 'sent', 'dead']).optional() }).parse(req.query);
    return db.query<any>(
      `SELECT n.id,n.event,n.status,n.attempts,n.last_attempt_at,n.next_attempt_at,n.last_error,n.created_at,n.sent_at,r.code
         FROM notifications n LEFT JOIN requests r ON r.id=n.request_id
        WHERE ($1::text IS NULL OR n.status=$1) ORDER BY n.created_at DESC LIMIT 200`,
      [q.status ?? null],
    );
  });

  app.post('/api/admin/notifications/:id/retry', async (req) => {
    requireStaff(req.user!, 'audit:view');
    const id = (req.params as any).id;
    const r = await db.query<any>(`UPDATE notifications SET status='pending', next_attempt_at=now(), attempts=0 WHERE id=$1 AND status='dead' RETURNING id`, [id]);
    if (!r[0]) throw notFound('Notificación no encontrada o no está fallida');
    await audit(db, req.user!, 'notification.retry', 'notification', id);
    return { ok: true };
  });
};
