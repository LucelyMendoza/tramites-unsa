import { buildApp } from './app.js';
import { DevVerifier, FirebaseVerifier, HybridVerifier } from './auth/verifier.js';
import { allowedDomains, loadConfig } from './config.js';
import { createDb, migrate } from './db/index.js';
import { startWorker } from './notifications/outbox.js';
import { ConsoleProvider } from './notifications/providers/console.js';
import { ResendProvider } from './notifications/providers/resend.js';
import { syncAcademicUnits } from './scripts/academicUnits.js';
import { bootstrapSuperadmins, seedCatalogs, seedDevAssignmentRules, seedDevStaff, syncTramiteTypes } from './scripts/seedData.js';
import { createStorage } from './storage/index.js';

const cfg = loadConfig();
const db = await createDb(cfg);
const ran = await migrate(db);
if (ran.length) console.log('Migraciones aplicadas:', ran.join(', '));

const domains = allowedDomains(cfg);
// Facultades y escuelas oficiales (idempotente; también en producción).
if (await syncAcademicUnits(db)) console.log('Facultades y escuelas oficiales cargadas');
if (cfg.AUTH_MODE !== 'firebase') {
  // Solo desarrollo: catálogo y cuentas de PRUEBA.
  if (await seedCatalogs(db)) console.log('Catálogo ficticio de prueba cargado');
  else if (await syncTramiteTypes(db)) console.log('Catálogo de trámites actualizado');
  await seedDevStaff(db, domains[0]);
  if (await seedDevAssignmentRules(db, domains[0])) console.log('Reglas de responsables de prueba creadas');
}
if (cfg.BOOTSTRAP_SUPERADMINS) await bootstrapSuperadmins(db, cfg.BOOTSTRAP_SUPERADMINS, domains);

const storage = createStorage(cfg);
const mail = cfg.MAIL_PROVIDER === 'resend' ? new ResendProvider(cfg.RESEND_API_KEY, cfg.MAIL_FROM) : new ConsoleProvider();
const verifier =
  cfg.AUTH_MODE === 'firebase'
    ? new FirebaseVerifier(cfg)
    : cfg.AUTH_MODE === 'hybrid'
      ? new HybridVerifier(new DevVerifier(cfg.DEV_AUTH_SECRET), cfg.FIREBASE_PROJECT_ID ? new FirebaseVerifier(cfg) : undefined)
      : new DevVerifier(cfg.DEV_AUTH_SECRET);

const app = await buildApp({ cfg, db, storage, mail, verifier });
const stopWorker = startWorker(db, mail, cfg, (m) => app.log.info(m));

app.log.info(`Modo auth=${cfg.AUTH_MODE} storage=${storage.driver} mail=${mail.name} db=${db.kind}`);
if (cfg.AUTH_MODE !== 'firebase')
  app.log.warn(
    `MODO DE PRUEBAS: cuentas ficticias habilitadas${cfg.AUTH_MODE === 'hybrid' ? (cfg.FIREBASE_PROJECT_ID ? ' + Google (Firebase)' : ' (Google sin configurar: falta FIREBASE_PROJECT_ID)') : ''}. No usar con datos personales reales.`,
  );

const shutdown = async () => {
  stopWorker();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
