import type { Config } from '../config.js';
import type { Db, Queryable } from '../db/index.js';
import type { NotifyEvent } from '../domain/stateMachine.js';
import { render, type MailPayload } from './templates.js';
import { PermanentMailError, type MailProvider } from './providers/types.js';

/**
 * Encola una notificación DENTRO de la misma transacción que el cambio de estado (outbox transaccional):
 * si la transacción falla, no hay correo; si confirma, el correo no se pierde aunque el proveedor falle.
 * dedupe_key único evita duplicados si la operación se repite.
 */
export async function enqueue(
  q: Queryable,
  n: { requestId: string; userId: string; toEmail: string; event: NotifyEvent; dedupeSuffix: string; payload: MailPayload },
): Promise<void> {
  await q.query(
    `INSERT INTO notifications(request_id,user_id,to_email,event,payload,dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.requestId, n.userId, n.toEmail, n.event, JSON.stringify(n.payload), `${n.requestId}:${n.event}:${n.dedupeSuffix}`],
  );
}

const BACKOFF_MIN = [1, 5, 15, 60, 240, 720, 1440];

export function backoffMinutes(attempt: number): number {
  return BACKOFF_MIN[Math.min(attempt - 1, BACKOFF_MIN.length - 1)];
}

/** Procesa lote de notificaciones vencidas. Seguro con varias instancias (FOR UPDATE SKIP LOCKED). */
export async function processOutbox(
  db: Db,
  provider: MailProvider,
  cfg: Pick<Config, 'MAIL_MAX_ATTEMPTS'>,
  batch = 20,
): Promise<{ sent: number; failed: number; dead: number }> {
  // Recupera mensajes colgados en 'sending' (instancia caída a mitad de envío).
  await db.query(
    `UPDATE notifications SET status='pending' WHERE status='sending' AND last_attempt_at < now() - interval '5 minutes'`,
  );
  const rows = await db.query<any>(
    `UPDATE notifications SET status='sending', last_attempt_at=now(), attempts=attempts+1
     WHERE id IN (
       SELECT id FROM notifications WHERE status='pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [batch],
  );
  const out = { sent: 0, failed: 0, dead: 0 };
  for (const n of rows) {
    const mail = render(n.event, n.payload);
    try {
      const r = await provider.send({ to: n.to_email, ...mail, idempotencyKey: n.dedupe_key });
      await db.query(
        `UPDATE notifications SET status='sent', sent_at=now(), provider_message_id=$2, last_error=NULL WHERE id=$1`,
        [n.id, r.id],
      );
      out.sent++;
    } catch (e: any) {
      const permanent = e instanceof PermanentMailError;
      const dead = permanent || n.attempts >= cfg.MAIL_MAX_ATTEMPTS;
      const msg = String(e?.message ?? e).slice(0, 500);
      if (dead) {
        await db.query(`UPDATE notifications SET status='dead', last_error=$2 WHERE id=$1`, [n.id, msg]);
        out.dead++;
      } else {
        await db.query(
          `UPDATE notifications SET status='pending', last_error=$2, next_attempt_at = now() + ($3 || ' minutes')::interval WHERE id=$1`,
          [n.id, msg, String(backoffMinutes(n.attempts))],
        );
        out.failed++;
      }
    }
  }
  return out;
}

export function startWorker(db: Db, provider: MailProvider, cfg: Config, log: (m: string) => void) {
  let running = false;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await processOutbox(db, provider, cfg);
      if (r.sent || r.failed || r.dead) log(`[outbox] enviados=${r.sent} reintento=${r.failed} muertos=${r.dead}`);
    } catch (e: any) {
      log(`[outbox] error: ${e?.message ?? e}`);
    } finally {
      running = false;
    }
  }, cfg.MAIL_WORKER_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
