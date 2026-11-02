import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backoffMinutes, enqueue, processOutbox } from '../src/notifications/outbox.js';
import { PermanentMailError, TransientMailError, type MailProvider } from '../src/notifications/providers/types.js';
import { ResendProvider } from '../src/notifications/providers/resend.js';
import { DOMAIN, createSubmitted, makeCtx, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => (ctx = await makeCtx()));
afterAll(() => ctx.close());

const flaky = (errs: Error[]): MailProvider & { calls: number } => {
  const p: any = {
    name: 'flaky',
    calls: 0,
    async send() {
      p.calls++;
      const e = errs.shift();
      if (e) throw e;
      return { id: 'ok' + p.calls };
    },
  };
  return p;
};
const cfg = { MAIL_MAX_ATTEMPTS: 3 };

describe('outbox', () => {
  let reqId: string;
  it('reintenta ante fallo transitorio con backoff y luego envía', async () => {
    const s = ctx.token(`estudiante1@${DOMAIN}`);
    reqId = (await createSubmitted(ctx, s)).id;
    const p = flaky([new TransientMailError('503')]);
    expect(await processOutbox(ctx.db, p, cfg)).toMatchObject({ sent: 0, failed: 1 });
    const n = (await ctx.db.query<any>(`SELECT * FROM notifications WHERE request_id=$1`, [reqId]))[0];
    expect(n.status).toBe('pending');
    expect(n.attempts).toBe(1);
    expect(n.last_error).toContain('503');
    // aún no vence
    expect(await processOutbox(ctx.db, p, cfg)).toMatchObject({ sent: 0, failed: 0 });
    await ctx.db.query(`UPDATE notifications SET next_attempt_at=now() - interval '1 second'`);
    expect(await processOutbox(ctx.db, p, cfg)).toMatchObject({ sent: 1 });
    const n2 = (await ctx.db.query<any>(`SELECT * FROM notifications WHERE request_id=$1`, [reqId]))[0];
    expect(n2.status).toBe('sent');
    expect(n2.sent_at).not.toBeNull();
    expect(n2.last_attempt_at).not.toBeNull();
  });
  it('error permanente → dead sin reintentos', async () => {
    const s = ctx.token(`estudiante2@${DOMAIN}`);
    const { id } = await createSubmitted(ctx, s, 'CONST_EGRESADO_PRE', { dni: '70000002' });
    const p = flaky([new PermanentMailError('422 dominio no verificado')]);
    expect(await processOutbox(ctx.db, p, cfg)).toMatchObject({ dead: 1 });
    const n = (await ctx.db.query<any>(`SELECT status,attempts FROM notifications WHERE request_id=$1`, [id]))[0];
    expect(n.status).toBe('dead');
    expect(n.attempts).toBe(1);
  });
  it('alcanzar el máximo de intentos → dead', async () => {
    const s = ctx.token(`estudiante3@${DOMAIN}`);
    const { id } = await createSubmitted(ctx, s, 'CONST_EGRESADO_PRE', { dni: '70000003' });
    const p = flaky([new TransientMailError('x'), new TransientMailError('x'), new TransientMailError('x')]);
    for (let i = 0; i < 3; i++) {
      await ctx.db.query(`UPDATE notifications SET next_attempt_at=now() - interval '1 second' WHERE request_id=$1`, [id]);
      await processOutbox(ctx.db, p, cfg);
    }
    expect((await ctx.db.query<any>(`SELECT status FROM notifications WHERE request_id=$1`, [id]))[0].status).toBe('dead');
  });
  it('dedupe: encolar dos veces el mismo evento no duplica', async () => {
    const before = (await ctx.db.query<any>(`SELECT count(*)::int n FROM notifications WHERE request_id=$1`, [reqId]))[0].n;
    const u = (await ctx.db.query<any>(`SELECT user_id FROM requests WHERE id=$1`, [reqId]))[0];
    const key = (await ctx.db.query<any>(`SELECT dedupe_key FROM notifications WHERE request_id=$1 AND event='REGISTRADA'`, [reqId]))[0].dedupe_key as string;
    const suffix = key.split(':').slice(2).join(':');
    for (let i = 0; i < 2; i++)
      await enqueue(ctx.db, { requestId: reqId, userId: u.user_id, toEmail: 'a@unsa.edu.pe', event: 'REGISTRADA', dedupeSuffix: suffix, payload: { code: 'TD-X', tramite: 'x', link: 'http://x' } as any });
    const after = (await ctx.db.query<any>(`SELECT count(*)::int n FROM notifications WHERE request_id=$1`, [reqId]))[0].n;
    expect(after).toBe(before);
  });
  it('backoff creciente y acotado', () => {
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(3)).toBe(15);
    expect(backoffMinutes(99)).toBe(1440);
  });
});

describe('ResendProvider', () => {
  const msg = { to: 'a@unsa.edu.pe', subject: 's', text: 't', html: '<p>t</p>', idempotencyKey: 'k1' };
  it('envía con Authorization e Idempotency-Key', async () => {
    let seen: any;
    const f: any = async (url: string, init: any) => ((seen = { url, init }), new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    const r = await new ResendProvider('re_key', 'Trámites <t@x.pe>', f).send(msg);
    expect(r.id).toBe('abc');
    expect(seen.url).toBe('https://api.resend.com/emails');
    expect(seen.init.headers['Idempotency-Key']).toBe('k1');
    expect(seen.init.headers.Authorization).toBe('Bearer re_key');
  });
  it('429/5xx transitorio; 4xx permanente; red transitorio', async () => {
    const mk = (status: number) => new ResendProvider('k', 'f', (async () => new Response('err', { status })) as any);
    await expect(mk(429).send(msg)).rejects.toBeInstanceOf(TransientMailError);
    await expect(mk(503).send(msg)).rejects.toBeInstanceOf(TransientMailError);
    await expect(mk(422).send(msg)).rejects.toBeInstanceOf(PermanentMailError);
    const net = new ResendProvider('k', 'f', (async () => { throw new Error('ECONNRESET'); }) as any);
    await expect(net.send(msg)).rejects.toBeInstanceOf(TransientMailError);
  });
  it('exige API key', () => {
    expect(() => new ResendProvider('', 'f')).toThrow();
  });
});
