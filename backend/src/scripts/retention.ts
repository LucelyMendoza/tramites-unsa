/**
 * Política de conservación (ver docs/SEGURIDAD_Y_DATOS.md). Ejecutar a diario (Render Cron Job).
 *  1. Elimina del almacenamiento los adjuntos sensibles (DNI, boleta) de solicitudes FINALIZADAS hace más de
 *     RETENTION_ATTACHMENTS_MONTHS meses. Se conservan los metadatos y el historial (sin binario).
 *  2. Elimina borradores abandonados (>30 días) y cargas pendientes huérfanas (>1 día).
 * Los plazos son PROPUESTOS; deben validarse con Archivo Central / Oficina de Control Interno y el Oficial de Datos Personales.
 *   --dry-run  solo informa.
 */
import { loadConfig } from '../config.js';
import { createDb, migrate, type Db } from '../db/index.js';
import { createStorage, type Storage } from '../storage/index.js';
import { audit } from '../modules/service.js';

export async function runRetention(db: Db, storage: Storage, months: number, dryRun: boolean) {
  const out = { attachmentsPurged: 0, draftsDeleted: 0, orphansDeleted: 0 };

  const expired = await db.query<any>(
    `SELECT f.id,f.object_key,f.request_id FROM request_files f JOIN requests r ON r.id=f.request_id
      WHERE r.status='FINALIZADA' AND r.finalized_at < now() - ($1 || ' months')::interval AND f.status IN ('verified','superseded')`,
    [String(months)],
  );
  for (const f of expired) {
    if (!dryRun) {
      await storage.delete(f.object_key);
      await db.query(`UPDATE request_files SET status='purged', purged_at=now(), is_current=false WHERE id=$1`, [f.id]);
      await audit(db, { email: 'retention-job' }, 'retention.purge_attachment', 'request', f.request_id, { fileId: f.id });
    }
    out.attachmentsPurged++;
  }

  const orphans = await db.query<any>(`SELECT id,object_key FROM request_files WHERE status IN ('pending','rejected') AND uploaded_at < now() - interval '1 day'`);
  for (const o of orphans) {
    if (!dryRun) {
      await storage.delete(o.object_key).catch(() => {});
      await db.query(`DELETE FROM request_files WHERE id=$1`, [o.id]);
    }
    out.orphansDeleted++;
  }

  const drafts = await db.query<any>(`SELECT id FROM requests WHERE status='BORRADOR' AND updated_at < now() - interval '30 days'`);
  for (const d of drafts) {
    if (!dryRun) {
      const files = await db.query<any>(`SELECT object_key FROM request_files WHERE request_id=$1`, [d.id]);
      for (const f of files) await storage.delete(f.object_key).catch(() => {});
      await db.tx(async (q) => {
        await q.query(`DELETE FROM request_files WHERE request_id=$1`, [d.id]);
        await q.query(`DELETE FROM requests WHERE id=$1`, [d.id]);
      });
      await audit(db, { email: 'retention-job' }, 'retention.delete_draft', 'request', d.id);
    }
    out.draftsDeleted++;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const db = await createDb(cfg);
  await migrate(db);
  const r = await runRetention(db, createStorage(cfg), cfg.RETENTION_ATTACHMENTS_MONTHS, process.argv.includes('--dry-run'));
  console.log(JSON.stringify(r));
  await db.close();
}
