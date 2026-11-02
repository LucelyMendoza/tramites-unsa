import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'pg';
}

const here = dirname(fileURLToPath(import.meta.url));

export async function createDb(cfg: Pick<Config, 'DATABASE_URL' | 'PGLITE_DIR'>): Promise<Db> {
  if (cfg.DATABASE_URL) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({
      connectionString: cfg.DATABASE_URL,
      max: 10,
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(cfg.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    });
    // Render/Neon usan TLS; rejectUnauthorized:false evita fallos con CA intermedia. En producción
    // propia, reemplazar por la CA del proveedor (ver docs/DESPLIEGUE.md).
    return {
      kind: 'pg',
      async query(sql, params) {
        const r = await pool.query(sql, params as any[]);
        return r.rows;
      },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({
            async query(sql, params) {
              const r = await client.query(sql, params as any[]);
              return r.rows;
            },
          });
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(cfg.PGLITE_DIR || undefined);
  await lite.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params) {
      const r = await lite.query(sql, params as any[]);
      return r.rows as any[];
    },
    async tx(fn) {
      return lite.transaction(async (t) =>
        fn({
          async query(sql, params) {
            const r = await t.query(sql, params as any[]);
            return r.rows as any[];
          },
        }),
      );
    },
    async close() {
      await lite.close();
    },
  };
}

/** Migraciones SQL versionadas (src/db/migrations/NNN_nombre.sql). Idempotente. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const dir = join(here, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    ran.push(f);
  }
  return ran;
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));
}
