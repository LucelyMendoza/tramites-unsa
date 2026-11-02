import { PermanentMailError, TransientMailError, type MailMessage, type MailProvider } from './types.js';

/** Proveedor real: API HTTPS de Resend (no usa SMTP, por lo que funciona en Render Free, que bloquea 25/465/587). */
export class ResendProvider implements MailProvider {
  readonly name = 'resend';
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('RESEND_API_KEY es obligatorio con MAIL_PROVIDER=resend');
  }

  async send(msg: MailMessage): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': msg.idempotencyKey,
        },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e: any) {
      throw new TransientMailError(`Red/timeout: ${e?.message ?? e}`);
    }
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: j.id ?? 'unknown' };
    }
    const body = (await res.text().catch(() => '')).slice(0, 300);
    // 429 y 5xx son temporales; el resto de 4xx (dominio no verificado, destinatario inválido) es permanente.
    if (res.status === 429 || res.status >= 500) throw new TransientMailError(`HTTP ${res.status}: ${body}`);
    throw new PermanentMailError(`HTTP ${res.status}: ${body}`);
  }
}
