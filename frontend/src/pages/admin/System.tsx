import { useEffect, useState } from 'react';
import { api, fmtDate } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Button, Card, Spinner } from '../../ui';

export default function System() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'audit' | 'mail' | 'staff'>('audit');
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = { audit: '/api/admin/audit?limit=100', mail: '/api/admin/notifications', staff: '/api/admin/staff' }[tab];
  const load = () => { setRows(null); api(`GET`, url).then(setRows).catch((e) => setErr(e.message)); };
  useEffect(load, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const canRetry = me?.staff?.role === 'superadmin';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Auditoría, correos y personal</h1>
      <div className="flex gap-2">{(['audit', 'mail', 'staff'] as const).map((t) => <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>{{ audit: 'Auditoría', mail: 'Cola de correos', staff: 'Personal' }[t]}</Button>)}</div>
      {err && <Alert kind="error">{err}</Alert>}
      {tab === 'staff' && <Alert kind="info">Los roles solo se otorgan desde el servidor (<code>npm run staff:grant</code> o BOOTSTRAP_SUPERADMINS). Esta vista es de solo lectura.</Alert>}
      <Card className="!p-0 overflow-x-auto">
        {!rows ? <Spinner /> : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              {tab === 'audit' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Entidad</th><th className="px-3 py-2">Detalle</th></tr>}
              {tab === 'mail' && <tr><th className="px-3 py-2">Creado</th><th className="px-3 py-2">Código</th><th className="px-3 py-2">Evento</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Intentos</th><th className="px-3 py-2">Último intento</th><th className="px-3 py-2">Error</th><th /></tr>}
              {tab === 'staff' && <tr><th className="px-3 py-2">Correo</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Alcance</th><th className="px-3 py-2">Activo</th><th className="px-3 py-2">Otorgado por</th></tr>}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => tab === 'audit' ? (
                <tr key={r.id ?? i}><td className="px-3 py-1.5">{fmtDate(r.created_at)}</td><td className="px-3 py-1.5">{r.actor_email}</td><td className="px-3 py-1.5 font-mono">{r.action}</td><td className="px-3 py-1.5">{r.entity}</td><td className="max-w-md truncate px-3 py-1.5 font-mono text-slate-500">{JSON.stringify(r.meta)}</td></tr>
              ) : tab === 'mail' ? (
                <tr key={r.id}><td className="px-3 py-1.5">{fmtDate(r.created_at)}</td><td className="px-3 py-1.5 font-mono">{r.code}</td><td className="px-3 py-1.5">{r.event}</td><td className="px-3 py-1.5">{r.status}</td><td className="px-3 py-1.5">{r.attempts}</td><td className="px-3 py-1.5">{fmtDate(r.last_attempt_at)}</td><td className="max-w-xs truncate px-3 py-1.5 text-red-700">{r.last_error}</td>
                  <td className="px-3 py-1.5">{r.status === 'dead' && canRetry && <Button variant="secondary" className="!px-2 !py-0.5 !text-xs" onClick={() => api('POST', `/api/admin/notifications/${r.id}/retry`).then(load).catch((e) => setErr(e.message))}>Reintentar</Button>}</td></tr>
              ) : (
                <tr key={r.id}><td className="px-3 py-1.5">{r.email}</td><td className="px-3 py-1.5">{r.role}</td><td className="px-3 py-1.5">{r.scope ? `${r.scope.length} facultad(es)` : 'Todas'}</td><td className="px-3 py-1.5">{r.active ? 'Sí' : 'No'}</td><td className="px-3 py-1.5">{r.grantedBy}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
