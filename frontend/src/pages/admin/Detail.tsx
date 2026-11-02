import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, fmtDate, fmtSize, putToStorage } from '../../api';
import { DocumentViewer } from '../../components/DocumentViewer';
import { useAuth } from '../../auth';
import type { Detail as D } from '../../types';
import { Alert, Button, Card, inputCls, Spinner, StatusBadge } from '../../ui';
import { FilesTable, Timeline } from '../RequestDetail';

interface Assignee { id: string; email: string; name?: string; role: string; away?: boolean; awayUntil?: string | null }

export default function AdminDetail() {
  const { id } = useParams();
  const [d, setD] = useState<D | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewIssued, setViewIssued] = useState(false);
  const { config } = useAuth();
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [decl, setDecl] = useState('');

  const load = useCallback(() => api<D>('GET', `/api/admin/requests/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); api<Assignee[]>('GET', '/api/admin/assignees').then(setAssignees).catch(() => {}); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null); setOk(null);
    try { await fn(); setOk(label); await load(); } catch (e) {
      const x = e as ApiError;
      setErr(x.details?.unmet ? `${x.message}: ${x.details.unmet.join('; ')}` : x.message);
    } finally { setBusy(false); }
  };
  const post = (path: string, body?: unknown) => api('POST', `/api/admin/requests/${id}/${path}`, body ?? {});

  async function uploadIssued(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') return setErr('El documento emitido debe ser PDF');
    await run('Documento emitido cargado y validado', async () => {
      const p = await api<{ docId: string; upload: { url: string; method: string; headers: Record<string, string> } }>('POST', `/api/admin/requests/${id}/issued/presign`, { filename: file.name, size: file.size });
      await putToStorage(p.upload, file);
      await post(`issued/${p.docId}/complete`);
    });
  }

  if (!d) return err ? <Alert kind="error">{err}</Alert> : <Spinner />;
  const can = d.can!;
  const toggle = (k: string) => setTargets((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
  const targetOptions: [string, string][] = [
    ...d.config.requiredDocs.map((x): [string, string] => [`file:${x.slot}`, x.label]),
    ['field:dni', 'DNI'], ['field:cui', 'CUI'], ['field:faculty_id', 'Facultad'], ['field:school_id', 'Escuela'],
    ...d.config.fields.map((x): [string, string] => [`field:td.${x.key}`, x.label]),
  ];
  const canReview = can.review && ['ENVIADA', 'REENVIADA', 'EN_REVISION'].includes(d.status);
  const verifiedIssued = d.issuedDocuments.find((x) => x.status === 'verified');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to="/admin" className="text-xs text-brand-700 hover:underline">← Solicitudes</Link>
          <h1 className="text-xl font-semibold">{d.tramiteName} <span className="font-mono text-base text-slate-500">{d.code}</span></h1>
          <p className="text-sm text-slate-600">{d.apellidosNombres} · {d.ownerEmail}</p>
        </div>
        <StatusBadge status={d.status} />
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-2 text-base font-semibold">Datos</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Solicitante</dt><dd>{d.applicantType}</dd></div>
              <div><dt className="text-xs text-slate-500">DNI</dt><dd>{d.dni}</dd></div><div><dt className="text-xs text-slate-500">CUI</dt><dd>{d.cui}</dd></div>
              <div><dt className="text-xs text-slate-500">Facultad</dt><dd>{d.facultyName}</dd></div><div><dt className="text-xs text-slate-500">Escuela</dt><dd>{d.schoolName}</dd></div>
              {d.config.fields.map((f) => <div key={f.key}><dt className="text-xs text-slate-500">{f.label}</dt><dd>{(() => { const v = d.typeData[f.key]; return Array.isArray(v) ? v.join(', ') : String(v ?? '—'); })()}</dd></div>)}
              <div><dt className="text-xs text-slate-500">Enviada</dt><dd>{fmtDate(d.submittedAt)}</dd></div><div><dt className="text-xs text-slate-500">Reenvíos</dt><dd>{d.resubmitCount}</dd></div>
              <div><dt className="text-xs text-slate-500">Responsable</dt><dd>{d.assignedEmail ?? 'Sin asignar'}</dd></div>
            </dl>
            {d.directoryCheck && <p className="mt-3 text-xs text-slate-500">Verificación contra padrón académico: <strong>{d.directoryCheck.status}</strong> {d.directoryCheck.message ?? ''} (informativa; no sustituye la revisión).</p>}
          </Card>
          <Card><h2 className="mb-2 text-base font-semibold">Documentos adjuntos</h2><FilesTable d={d} downloadBase="/api" /></Card>
          {d.declaration && (
            <Card>
              <h2 className="mb-1 text-base font-semibold">Declaración jurada (Posgrado / Segunda especialidad)</h2>
              <p className="text-xs text-slate-600">«{d.declaration.text}» · aceptada {fmtDate(d.declaration.acceptedAt)} · texto {d.declaration.textVersion}</p>
              <p className="mt-2 text-sm">Estado de verificación: <strong>{d.declaration.verificationStatus}</strong> {d.declaration.verificationNote ? `— ${d.declaration.verificationNote}` : ''}</p>
              <Alert kind="warn">La aceptación del checkbox NO equivale a una autorización verificada. La Unidad de Posgrado debe confirmarla.</Alert>
              {can.verifyDeclaration && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className={`${inputCls} max-w-xs`} placeholder="Nota (opcional)" value={decl} onChange={(e) => setDecl(e.target.value)} />
                  <Button disabled={busy} onClick={() => run('Declaración marcada como verificada', () => post('declaration/verify', { status: 'verificada', note: decl || undefined }))}>Marcar verificada</Button>
                  <Button variant="danger" disabled={busy} onClick={() => run('Declaración rechazada', () => post('declaration/verify', { status: 'rechazada', note: decl || undefined }))}>Rechazar</Button>
                </div>
              )}
            </Card>
          )}
          <Card>
            <h2 className="mb-2 text-base font-semibold">Observaciones y notas</h2>
            {d.observations.length === 0 ? <p className="text-sm text-slate-500">Sin observaciones.</p> : (
              <ul className="space-y-2 text-sm">
                {d.observations.map((o) => (
                  <li key={o.id} className="rounded bg-slate-50 p-2">
                    <div className="text-xs text-slate-500">{o.kind === 'nota' ? 'Nota interna' : 'Subsanación'} · {o.author} · {fmtDate(o.createdAt)}{o.resolvedAt ? ' · resuelta' : ''}</div>
                    <div>{o.reason}</div>{o.targetLabels.length > 0 && <div className="text-xs text-slate-600">A corregir: {o.targetLabels.map((t) => t.label).join(', ')}</div>}
                  </li>
                ))}
              </ul>
            )}
            {can.review && (
              <div className="mt-3 flex gap-2">
                <input className={inputCls} placeholder="Agregar nota interna" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button variant="secondary" disabled={busy || note.length < 3} onClick={() => run('Nota agregada', async () => { await post('notes', { reason: note }); setNote(''); })}>Agregar</Button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-base font-semibold">Acciones</h2>
            <div className="space-y-3 text-sm">
              {can.assign && (
                <select className={inputCls} value={d.assignedTo ?? ''} aria-label="Responsable" onChange={(e) => run('Responsable actualizado', () => post('assign', { userId: e.target.value || null }))}>
                  <option value="">Sin asignar</option>{assignees.map((a) => <option key={a.id} value={a.id} disabled={a.away && a.id !== d.assignedTo}>{a.name || a.email}{a.away ? ` — de vacaciones${a.awayUntil ? ` hasta ${a.awayUntil}` : ''}` : ''}</option>)}
                </select>
              )}
              {canReview && d.status !== 'EN_REVISION' && <Button className="w-full" disabled={busy} onClick={() => run('Revisión iniciada', () => post('review', { action: 'start_review' }))}>Iniciar revisión</Button>}
              {canReview && d.status === 'EN_REVISION' && (
                <>
                  <Button className="w-full" disabled={busy} onClick={() => run('Solicitud aprobada: pasa a En trámite', () => post('review', { action: 'approve' }))}>Aprobar → En trámite</Button>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                    <div className="mb-1 text-xs font-medium text-amber-900">Solicitar subsanación</div>
                    <textarea className={inputCls} rows={3} placeholder="Motivo (visible para el solicitante y en el correo)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                      {targetOptions.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={targets.includes(k)} onChange={() => toggle(k)} />{l}</label>)}
                    </div>
                    <Button variant="danger" className="mt-2 w-full" disabled={busy || reason.trim().length < 10 || targets.length === 0}
                      onClick={() => run('Subsanación solicitada; se notificó al solicitante', async () => { await post('review', { action: 'request_correction', reason, targets: targets.map((t) => ({ type: t.split(':')[0], key: t.slice(t.indexOf(':') + 1) })) }); setReason(''); setTargets([]); })}>Solicitar subsanación</Button>
                  </div>
                </>
              )}
              {!can.issue && ['EN_TRAMITE', 'EMITIDA'].includes(d.status) && <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">Su rol no permite cargar ni reenviar el documento emitido.</p>}
              {d.status === 'EMITIDA' && <ReceiptBox d={d} />}
              {can.issue && ['EN_TRAMITE', 'EMITIDA'].includes(d.status) && (
                <div className="rounded-md border border-slate-200 p-2">
                  <div className="mb-1 text-xs font-medium">{d.receipt.openComplaint ? 'Documento corregido (PDF)' : 'Documento emitido (PDF)'}</div>
                  {verifiedIssued && <p className="mb-1 text-xs text-emerald-700">✔ v{verifiedIssued.version}: {verifiedIssued.originalName} ({fmtSize(verifiedIssued.sizeBytes)})</p>}
                  <label className={`mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${busy ? 'pointer-events-none opacity-50' : ''} ${d.receipt.openComplaint && !d.receipt.canResend ? 'bg-brand-700 text-white ring-brand-700 hover:bg-brand-800' : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50'}`}>
                    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>
                    {verifiedIssued ? (d.receipt.openComplaint ? 'Subir PDF corregido (reemplaza al anterior)' : 'Reemplazar PDF emitido') : 'Subir PDF emitido'}
                    <input type="file" accept="application/pdf" className="sr-only" disabled={busy} onChange={(e) => { uploadIssued(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  <p className="mt-1 text-[11px] text-slate-500">Solo PDF · máximo {config?.maxFileMb ?? 5} MB · la versión anterior se conserva en el historial.</p>
                  {d.status === 'EN_TRAMITE' && <Button className="mt-2 w-full" disabled={busy || !verifiedIssued} onClick={() => run('Emisión registrada; se notificó al solicitante', () => post('emit'))}>Registrar emisión</Button>}
                  {d.status === 'EMITIDA' && d.receipt.openComplaint && (
                    <>
                      <p className="mt-2 text-[11px] text-slate-500">{d.receipt.canResend ? `Versión ${d.receipt.currentVersion} lista para reenviar.` : 'Paso 1: cargue el PDF corregido. Paso 2: reenvíelo al solicitante.'}</p>
                      <Button className="mt-2 w-full" disabled={busy || !d.receipt.canResend} onClick={() => run('Documento corregido reenviado; el solicitante deberá confirmar otra vez', () => post('reissue'))}>Reenviar documento corregido</Button>
                    </>
                  )}
                </div>
              )}
              {can.finalize && d.status === 'EMITIDA' && d.receipt.answer === 'si' && <Button className="w-full" disabled={busy} onClick={() => run('Trámite finalizado', () => post('finalize'))}>Finalizar trámite</Button>}
              {can.finalize && d.status === 'EMITIDA' && d.receipt.answer !== 'si' && !d.receipt.openComplaint && (
                <details className="rounded-md border border-slate-200 p-2 text-xs">
                  <summary className="cursor-pointer font-medium text-slate-600">Finalizar sin confirmación del solicitante</summary>
                  <textarea className={`${inputCls} mt-2`} rows={2} placeholder="Motivo (mín. 10 caracteres), p. ej. no responde tras varios recordatorios" value={override} onChange={(e) => setOverride(e.target.value)} />
                  <Button variant="secondary" className="mt-2 w-full" disabled={busy || override.trim().length < 10} onClick={() => run('Trámite finalizado sin confirmación', async () => { await post('finalize', { overrideReason: override }); setOverride(''); })}>Finalizar con este motivo</Button>
                </details>
              )}
              {verifiedIssued && <Button variant="ghost" onClick={() => setViewIssued(true)}>Ver documento emitido</Button>}
              {verifiedIssued && viewIssued && <DocumentViewer path={`/api/issued/${verifiedIssued.id}/download-url`} title="Documento emitido" onClose={() => setViewIssued(false)} />}
            </div>
          </Card>
          <Card><h2 className="mb-2 text-base font-semibold">Historial</h2><Timeline d={d} /></Card>
        </div>
      </div>
    </div>
  );
}

/** Estado de la encuesta de recepción del solicitante. */
function ReceiptBox({ d }: { d: D }) {
  const r = d.receipt;
  const box = (tone: string, children: React.ReactNode) => <div className={`rounded-md p-2.5 text-xs ring-1 ${tone}`}>{children}</div>;
  return (
    <div className="space-y-2">
      {r.openComplaint
        ? box('bg-red-50 text-red-900 ring-red-200', <><div className="font-semibold">El solicitante indicó que el documento NO le llegó correctamente</div><p className="mt-1 whitespace-pre-wrap">«{r.openComplaint.message}»</p><p className="mt-1 text-red-800/80">Sobre la versión {r.openComplaint.version} · {fmtDate(r.openComplaint.answeredAt)}</p></>)
        : r.answer === 'si'
          ? box('bg-emerald-50 text-emerald-900 ring-emerald-200', <><span className="font-semibold">✔ El solicitante confirmó que recibió correctamente el documento</span></>)
          : box('bg-amber-50 text-amber-900 ring-amber-200', <><span className="font-semibold">Esperando que el solicitante confirme la recepción</span> (versión {r.currentVersion}). La respuesta es obligatoria en su portal.</>)}
      {r.history.length > 1 && (
        <ul className="space-y-0.5 text-[11px] text-slate-500">
          {r.history.map((h, i) => <li key={i}>v{h.version}: {h.answer === 'si' ? 'Sí' : `No — «${h.message}»`}{h.resolvedAt ? ' (corregido y reenviado)' : ''} · {fmtDate(h.answeredAt)}</li>)}
        </ul>
      )}
    </div>
  );
}
