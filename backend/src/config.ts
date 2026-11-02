import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // ---- Base de datos ----
  // DATABASE_URL vacío => PGlite embebido (solo desarrollo/pruebas, datos en memoria o en PGLITE_DIR)
  DATABASE_URL: z.string().optional().default(''),
  PGLITE_DIR: z.string().optional().default(''),

  // ---- Autenticación ----
  // dev = solo cuentas de prueba · firebase = solo Google · hybrid = ambos (solo desarrollo/pruebas)
  AUTH_MODE: z.enum(['dev', 'firebase', 'hybrid']).default('dev'),
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  // En Render: pegar el JSON de la cuenta de servicio en esta variable (o usar GOOGLE_APPLICATION_CREDENTIALS)
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  ALLOWED_EMAIL_DOMAINS: z.string().default('unsa.edu.pe'),
  DEV_AUTH_SECRET: z.string().default('dev-only-secret-change-me'),
  DEV_TEST_ACCOUNTS_ENABLED: bool.default(true),

  // ---- Almacenamiento ----
  // local = disco, SOLO desarrollo · disk = disco de un servidor propio (producción on-premise)
  // r2 = Cloudflare R2 · s3 = cualquier almacenamiento compatible con S3 (AWS, SeaweedFS, Ceph…)
  STORAGE_DRIVER: z.enum(['local', 'disk', 'r2', 's3']).default('local'),
  DISK_STORAGE_DIR: z.string().default('/data/archivos'),
  /** Firma de los enlaces temporales del modo disk (≥ 32 caracteres aleatorios). */
  STORAGE_SIGNING_SECRET: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: bool.default(true),
  LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  R2_ENDPOINT: z.string().optional().default(''),
  PRESIGN_UPLOAD_TTL_SECONDS: z.coerce.number().default(300),
  PRESIGN_DOWNLOAD_TTL_SECONDS: z.coerce.number().default(60),

  // ---- Archivos ----
  MAX_FILE_MB: z.coerce.number().default(5),

  // ---- Correo ----
  MAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  MAIL_FROM: z.string().default('Trámites <no-reply@example.edu.pe>'),
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_WORKER_INTERVAL_MS: z.coerce.number().default(15000),
  MAIL_MAX_ATTEMPTS: z.coerce.number().default(8),

  // ---- Reglas institucionales (CONFIRMAR con la universidad) ----
  // Patrón del CUI. Valor por defecto = solo dígitos. NO es una regla institucional confirmada.
  CUI_PATTERN: z.string().default('^\\d+$'),
  // Fuente institucional para contrastar datos: none | fixture (datos de prueba)
  ACADEMIC_DIRECTORY: z.enum(['none', 'fixture']).default('fixture'),

  // ---- Conservación (valores PROPUESTOS, validar con Archivo Central / OCI) ----
  RETENTION_ATTACHMENTS_MONTHS: z.coerce.number().default(12),

  // Cuentas con rol superadmin al arrancar (bootstrap). Después se gestionan por CLI.
  BOOTSTRAP_SUPERADMINS: z.string().optional().default(''),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (cfg.AUTH_MODE !== 'firebase') problems.push(`AUTH_MODE=${cfg.AUTH_MODE} no está permitido en producción`);
    if (cfg.DEV_TEST_ACCOUNTS_ENABLED && cfg.AUTH_MODE !== 'firebase') problems.push('Cuentas de prueba habilitadas');
    if (cfg.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER=local no está permitido en producción (use disk, r2 o s3)');
    if (cfg.STORAGE_DRIVER === 'disk' && cfg.STORAGE_SIGNING_SECRET.length < 32)
      problems.push('STORAGE_DRIVER=disk exige STORAGE_SIGNING_SECRET de al menos 32 caracteres');
    if (cfg.STORAGE_DRIVER === 'disk' && !/^https:\/\//.test(cfg.PUBLIC_API_URL)) problems.push('PUBLIC_API_URL debe ser https:// en producción');
    if (!cfg.DATABASE_URL) problems.push('DATABASE_URL es obligatorio en producción');
    if (cfg.DEV_AUTH_SECRET === 'dev-only-secret-change-me' && cfg.AUTH_MODE === 'dev')
      problems.push('DEV_AUTH_SECRET por defecto');
    if (cfg.MAIL_PROVIDER === 'console') problems.push('MAIL_PROVIDER=console no envía correos reales');
    if (problems.length) throw new Error('Configuración insegura para producción: ' + problems.join('; '));
  }
  return cfg;
}

/** Google habilitado: modo firebase/hybrid con proyecto configurado. */
export const googleEnabled = (cfg: Config) => cfg.AUTH_MODE !== 'dev' && !!cfg.FIREBASE_PROJECT_ID;
/** Cuentas de prueba: nunca en producción ni en modo firebase. */
export const testAccountsEnabled = (cfg: Config) =>
  cfg.AUTH_MODE !== 'firebase' && cfg.NODE_ENV !== 'production' && cfg.DEV_TEST_ACCOUNTS_ENABLED;

export function allowedDomains(cfg: Config): string[] {
  return cfg.ALLOWED_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
