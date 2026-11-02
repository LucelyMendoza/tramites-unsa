import type { MailMessage, MailProvider } from './types.js';

/**
 * Proveedor de DESARROLLO: no envía nada a internet. Guarda los mensajes en memoria (consultables en
 * /api/dev/mailbox) y los imprime. No debe confundirse con envío real.
 */
export class ConsoleProvider implements MailProvider {
  readonly name = 'console';
  readonly sent: (MailMessage & { id: string; at: string })[] = [];
  failNext = 0; // para pruebas de reintento
  constructor(private log: (m: string) => void = (m) => console.log(m)) {}

  async send(msg: MailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      const { TransientMailError } = await import('./types.js');
      throw new TransientMailError('fallo simulado');
    }
    const id = `console-${this.sent.length + 1}`;
    this.sent.push({ ...msg, id, at: new Date().toISOString() });
    if (this.sent.length > 200) this.sent.shift();
    this.log(`[mail:console] to=${msg.to} subject="${msg.subject}"`);
    return { id };
  }
}
