import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Button, inputCls } from '../ui';
import { DocumentViewer } from './DocumentViewer';

interface Pending { requestId: string; code: string; tramiteName: string; docId: string; fileName: string }

/** Pregunta "¿Le llegó correctamente el documento?" (Sí / No + mensaje). */
export function ReceiptQuestion({ requestId, docId, title, onDone }: { requestId: string; docId: string; title: string; onDone(status: string): void }) {
  const [answer, setAnswer] = useState<'si' | 'no' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState(false);
  const send = async () => {
    if (!answer) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ status: string }>('POST', `/api/requests/${requestId}/receipt`, answer === 'no' ? { answer, message } : { answer });
      onDone(r.status);
    } catch (e: any) { setErr(e.details?.message ?? e.message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      {view && <DocumentViewer path={`/api/issued/${docId}/download-url`} title={title} onClose={() => setView(false)} />}
      <Button variant="secondary" className="w-full" onClick={() => setView(true)}>Ver el documento emitido</Button>
      <p className="mt-5 text-sm font-semibold text-slate-900">¿Le llegó correctamente el documento? <span className="text-red-600">*</span></p>
      <div className="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label="¿Le llegó correctamente el documento?">
        {(['si', 'no'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={answer === v} onClick={() => setAnswer(v)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold ring-1 ring-inset transition ${answer === v
              ? v === 'si' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-red-600 text-white ring-red-600'
              : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>
            {v === 'si' ? 'Sí, está correcto' : 'No, tiene un problema'}
          </button>
        ))}
      </div>
      {answer === 'no' && (
        <label className="mt-4 block text-sm font-medium text-slate-700">
          ¿Qué problema tiene el documento? <span className="text-red-600">*</span>
          <textarea className={`${inputCls} mt-1.5`} rows={4} maxLength={1000} autoFocus value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Ej.: mi segundo apellido está mal escrito; falta el año 2023; el archivo no abre…" />
          <span className="mt-1 block text-xs text-slate-500">Se enviará al responsable de su trámite para que corrija y le reenvíe el documento.</span>
        </label>
      )}
      {err && <div className="mt-3"><Alert kind="error">{err}</Alert></div>}
      <Button className="mt-5 w-full" disabled={busy || !answer || (answer === 'no' && message.trim().length < 5)} onClick={send}>
        {busy ? 'Enviando…' : 'Enviar respuesta'}
      </Button>
    </div>
  );
}

/** Ventana obligatoria: aparece mientras el solicitante tenga documentos emitidos sin confirmar. */
export function ReceiptGate() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => api<Pending[]>('GET', '/api/me/pending-receipts').then(setPending).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const cur = pending[0];
  if (!cur && !done) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Confirmación de recepción" className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        {done ? (
          <>
            <h2 className="text-lg font-semibold text-slate-900">¡Gracias por responder!</h2>
            <p className="mt-2 text-sm text-slate-600">{done === 'FINALIZADA' ? 'Su trámite quedó finalizado.' : 'Registramos su respuesta. El responsable de su trámite revisará el documento y se lo reenviará; le avisaremos por correo.'}</p>
            <Button className="mt-5 w-full" onClick={() => { setDone(null); if (!pending.length) window.location.reload(); }}>{pending.length ? 'Continuar' : 'Cerrar'}</Button>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">Respuesta obligatoria</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Confirme la recepción de su documento</h2>
            <p className="mt-1 text-sm text-slate-600">{cur.tramiteName} · <span className="font-mono">{cur.code}</span></p>
            {pending.length > 1 && <p className="mt-1 text-xs text-slate-500">Tiene {pending.length} documentos por confirmar.</p>}
            <div className="mt-5">
              <ReceiptQuestion key={cur.docId} requestId={cur.requestId} docId={cur.docId} title={`${cur.tramiteName} · ${cur.code}`}
                onDone={(status) => { setDone(status); load(); }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
