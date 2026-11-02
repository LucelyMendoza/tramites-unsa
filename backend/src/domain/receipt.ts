import type { Queryable } from '../db/index.js';
import type { TramiteConfig } from './tramiteConfig.js';

/** Estado de la confirmación de recepción del documento emitido VIGENTE. */
export async function receiptState(q: Queryable, requestId: string, status: string) {
  const doc = (await q.query<any>(`SELECT id,version FROM issued_documents WHERE request_id=$1 AND status='verified'`, [requestId]))[0];
  const rows = await q.query<any>(
    `SELECT c.*, d.version FROM receipt_confirmations c JOIN issued_documents d ON d.id=c.issued_document_id
      WHERE c.request_id=$1 ORDER BY c.answered_at`,
    [requestId],
  );
  const current = doc ? rows.find((r) => r.issued_document_id === doc.id) : undefined;
  const openComplaint = rows.filter((r) => r.answer === 'no' && !r.resolved_at).at(-1);
  return {
    currentDocId: doc?.id ?? null,
    currentVersion: doc?.version ?? null,
    /** El solicitante debe responder: hay documento emitido vigente y aún no contestó por esa versión. */
    pending: status === 'EMITIDA' && !!doc && !current,
    answer: current ? (current.answer as 'si' | 'no') : null,
    /** Reclamo abierto y ya hay una versión NUEVA cargada → se puede reenviar. */
    canResend: !!openComplaint && !!doc && openComplaint.issued_document_id !== doc.id,
    openComplaint: openComplaint ? { message: openComplaint.message, answeredAt: openComplaint.answered_at, version: openComplaint.version } : null,
    history: rows.map((r) => ({ version: r.version, answer: r.answer, message: r.message, answeredAt: r.answered_at, resolvedAt: r.resolved_at })),
  };
}

/** Condiciones de la configuración del trámite para pasar a FINALIZADA (sin la confirmación de recepción). */
export async function finalizeUnmet(q: Queryable, requestId: string, config: TramiteConfig): Promise<string[]> {
  const unmet: string[] = [];
  for (const cond of config.finalizeRequires) {
    if (cond === 'issued_document') {
      const d = (await q.query<any>(`SELECT 1 FROM issued_documents WHERE request_id=$1 AND status='verified'`, [requestId]))[0];
      if (!d) unmet.push('Falta el documento emitido');
    }
    if (cond === 'declaration_verified' && config.requiresDeclaration) {
      const d = (await q.query<any>(`SELECT verification_status FROM declarations WHERE request_id=$1`, [requestId]))[0];
      if (!d || d.verification_status !== 'verificada') unmet.push('La autorización de la Unidad de Posgrado aún no fue verificada por el área responsable');
    }
  }
  return unmet;
}
