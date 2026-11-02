import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Alert, Button, Card, PageHeader, Pager, Spinner, StatusBadge } from '../ui';
import type { Status } from '../types';

interface Row { id: string; code: string | null; status: Status; tramiteName: string; createdAt: string; submittedAt: string | null; updatedAt: string }
interface Notif { id: string; event: string; status: 'enviada' | 'pendiente' | 'fallida'; createdAt: string; code: string | null; requestId: string }
const EVENT_LABEL: Record<string, string> = { REGISTRADA: 'Solicitud registrada', SUBSANACION: 'Subsanación requerida', REENVIADA: 'Solicitud reenviada', EN_TRAMITE: 'En trámite', EMITIDA: 'Documento emitido', FINALIZADA: 'Trámite finalizado', REEMITIDA: 'Documento corregido y reenviado' };

export default function Home() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: Row[] } | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api('GET', `/api/requests?page=${page}&pageSize=10`).then(setData).catch((e) => setErr(e.message)); }, [page]);
  useEffect(() => { api('GET', '/api/me/notifications').then(setNotifs).catch(() => {}); }, []);

  if (err) return <Alert kind="error">{err}</Alert>;
  if (!data) return <Spinner />;
  const pending = data.items.filter((r) => r.status === 'REQUIERE_SUBSANACION');

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <PageHeader
          title="Mis trámites"
          subtitle="Siga el estado de sus solicitudes y atienda las observaciones."
          actions={<Link to="/nuevo"><Button>+ Nueva solicitud</Button></Link>}
        />
        {pending.length > 0 && <Alert kind="warn">Tiene {pending.length} solicitud(es) que requieren subsanación. Ábralas para ver qué debe corregir.</Alert>}
        <Card className="!p-0">
          {data.items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-xl text-brand-700">📄</div>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">Aún no tiene solicitudes</h2>
              <p className="mt-1 max-w-sm text-sm text-slate-500">Solicite un certificado, constancia o boleta de notas. Podrá seguir cada etapa desde aquí.</p>
              <Link to="/nuevo" className="mt-5"><Button>Crear mi primera solicitud</Button></Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/solicitud/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 transition hover:bg-slate-50">
                    <div>
                      <div className="text-sm font-medium">{r.tramiteName}</div>
                      <div className="text-xs text-slate-500">{r.code ?? 'Sin enviar'} · {r.submittedAt ? `Enviada ${fmtDate(r.submittedAt)}` : `Creada ${fmtDate(r.createdAt)}`}</div>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      </div>
      <aside>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Notificaciones por correo</h2>
          {notifs.length === 0 ? <p className="text-xs text-slate-500">Sin notificaciones.</p> : (
            <ul className="space-y-2">
              {notifs.slice(0, 8).map((n) => (
                <li key={n.id} className="text-xs">
                  <Link to={`/solicitud/${n.requestId}`} className="font-medium text-brand-700 hover:underline">{EVENT_LABEL[n.event] ?? n.event}</Link>
                  <div className="text-slate-500">{n.code} · {fmtDate(n.createdAt)} · {n.status}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}
