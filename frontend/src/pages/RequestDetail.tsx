import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtSize } from '../api';
import { DocumentViewer } from '../components/DocumentViewer';
import RequestForm from '../components/RequestForm';
import type { Detail } from '../types';
import { Alert, Button, Card, Spinner, StatusBadge } from '../ui';

export function Timeline({ d }: { d: Detail }) {
  return (
    <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
      {d.history.map((h) => (
        <li key={h.id} className="relative text-sm">
          <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600" />
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={h.to} /><span className="text-xs text-slate-500">{fmtDate(h.at)} · {h.actor}</span></div>
          {h.reason && <p className="mt-1 text-xs text-slate-700">Motivo: {h.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

export function FilesTable({ d, downloadBase }: { d: Detail; downloadBase: string }) {
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);
  const label = (slot: string) => d.config.requiredDocs.find((x) => x.slot === slot)?.label ?? slot;
  return (
    <div>
      {viewing && <DocumentViewer path={viewing.path} title={viewing.title} onClose={() => setViewing(null)} />}
      <ul className="divide-y divide-slate-100 text-sm">
        {d.files.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{d.config.requiredDocs.find((x) => x.slot === f.slot)?.label ?? f.slot} <span className="whitespace-nowrap font-normal text-slate-500">· v{f.version}{f.isCurrent ? ' (vigente)' : ' (reemplazada)'}</span></div>
              <div className="truncate text-xs text-slate-500">{f.originalName} · {fmtSize(f.sizeBytes)} · {fmtDate(f.uploadedAt)}</div>
            </div>
            <Button variant="ghost" onClick={() => setViewing({ path: `${downloadBase}/files/${f.id}/download-url`, title: `${label(f.slot)} · v${f.version}` })}>Vista previa</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const load = useCallback(() => api<Detail>('GET', `/api/requests/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (err) return <Alert kind="error">{err}</Alert>;
  if (!d) return <Spinner />;
  const open = d.observations.filter((o) => o.kind === 'subsanacion' && !o.resolvedAt);

  if (d.status === 'BORRADOR')
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-xl font-semibold">Continuar solicitud (borrador)</h1>
        <RequestForm initial={d} onSent={() => { load(); }} />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/" className="text-xs text-brand-700 hover:underline">← Mis trámites</Link>
          <h1 className="text-xl font-semibold">{d.tramiteName}</h1>
          <p className="font-mono text-sm text-slate-600">{d.code}</p>
        </div>
        <StatusBadge status={d.status} />
      </div>
      {resent && <Alert kind="ok">Subsanación reenviada con el mismo código de expediente. Le avisaremos por correo cuando continúe el trámite.</Alert>}

      {d.status === 'REQUIERE_SUBSANACION' && (
        <>
          <Alert kind="warn">
            <strong>Se requiere subsanación.</strong>
            {open.map((o) => (
              <div key={o.id} className="mt-2">
                <p>{o.reason}</p>
                <p className="mt-1 text-xs">A corregir: {o.targetLabels.length ? o.targetLabels.map((t) => t.label).join(', ') : 'toda la solicitud'}</p>
              </div>
            ))}
          </Alert>
          <Card>
            <h2 className="mb-3 text-base font-semibold">Corregir y reenviar</h2>
            <RequestForm initial={d} onSent={() => { setResent(true); load(); }} />
          </Card>
        </>
      )}

      {viewing && <DocumentViewer path={viewing.path} title={viewing.title} onClose={() => setViewing(null)} />}
      {d.issuedDocuments.some((x) => x.status === 'verified') && (
        <Alert kind="ok">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Su documento ya fue emitido.</strong> Revíselo en la vista previa y descárguelo si lo necesita.
              {d.receipt.answer === 'si' && <span className="mt-1 block text-xs">✔ Usted confirmó que lo recibió correctamente.</span>}
              {d.receipt.openComplaint && <span className="mt-1 block text-xs text-red-800">Reportó un problema: «{d.receipt.openComplaint.message}». El responsable lo está corrigiendo; le avisaremos por correo.</span>}
            </span>
            {d.issuedDocuments.filter((x) => x.status === 'verified').map((x) => (
              <Button key={x.id} onClick={() => setViewing({ path: `/api/issued/${x.id}/download-url`, title: 'Documento emitido' })}>Ver {x.originalName}</Button>
            ))}
          </div>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-base font-semibold">Datos de la solicitud</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-slate-500">Apellidos y Nombres</dt><dd>{d.apellidosNombres}</dd></div>
            <div><dt className="text-xs text-slate-500">DNI / CUI</dt><dd>{d.dni} / {d.cui}</dd></div>
            <div><dt className="text-xs text-slate-500">Facultad</dt><dd>{d.facultyName}</dd></div>
            <div><dt className="text-xs text-slate-500">Escuela</dt><dd>{d.schoolName}</dd></div>
            {d.config.fields.map((f) => <div key={f.key}><dt className="text-xs text-slate-500">{f.label}</dt><dd>{(() => { const v = d.typeData[f.key]; return Array.isArray(v) ? v.join(', ') : String(v ?? '—'); })()}</dd></div>)}
            <div><dt className="text-xs text-slate-500">Enviada</dt><dd>{fmtDate(d.submittedAt)}</dd></div>
            <div><dt className="text-xs text-slate-500">Reenvíos</dt><dd>{d.resubmitCount}</dd></div>
          </dl>
          {d.declaration && <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">Declaración aceptada el {fmtDate(d.declaration.acceptedAt)}. Verificación por el área responsable: <strong>{d.declaration.verificationStatus}</strong>.</p>}
        </Card>
        <Card>
          <h2 className="mb-2 text-base font-semibold">Historial</h2>
          <Timeline d={d} />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-base font-semibold">Documentos (con historial de versiones)</h2>
          <FilesTable d={d} downloadBase="/api" />
        </Card>
      </div>
    </div>
  );
}
