export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Clave de idempotencia: el proveedor (si la soporta) no duplica el envío ante reintentos. */
  idempotencyKey: string;
}

export interface MailProvider {
  readonly name: string;
  send(msg: MailMessage): Promise<{ id: string }>;
}

export class TransientMailError extends Error {}
export class PermanentMailError extends Error {}
