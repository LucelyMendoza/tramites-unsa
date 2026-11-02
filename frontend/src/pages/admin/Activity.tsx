import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../../api';
import type { Status } from '../../types';
import { Alert, Card, inputCls, PageHeader, Spinner, StatusBadge } from '../../ui';

interface StaffRow {
  id: string; email: string; name: string; role: 'superadmin' | 'reviewer' | 'issuer';
  revisiones: number; aprobadas: number; subsanaciones: number; emitidas: number; finalizadas: number; reenviosCorregidos: number;
  abiertasAsignadas: number; ultimaActividad: string | null;
}
interface Feed { at: string; from: Status | null; to: Status; reason: string | null; actor: string; requestId: string; code: string; tramite: string }
const ROLE = { superadmin: 'Superadmin', reviewer: 'Revisor', issuer: 'Emisor' } as const;
const COLS: [keyof StaffRow, string][] = [
  ['revisiones', 'Revisiones'], ['aprobadas', 'Aprobadas'], ['subsanaciones', 'Subsanaciones'], ['emitidas', 'Emitidas'],
  ['finalizadas', 'Finalizadas'], ['reenviosCorregidos', 'Reenvíos corregidos'], ['abiertasAsignadas', 'Abiertas a su cargo'],
];

export default function AdminActivity() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [data, setData] = useState<{ staff: StaffRow[]; feed: Feed[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams(Object.entries({ from, to, userId }).filter(([, v]) => v)).toString();
    api<{ staff: StaffRow[]; feed: Feed[] }>('GET', `/api/admin/reports/staff-activity${qs ? '?' + qs : ''}`).then(setData).catch((e) => setErr(e.message));
  }, [from, to, userId]);

  if (err) return <Alert kind="error">{err}</Alert>;
  return (
    <div className="space-y-6">
      <PageHeader title="Actividad del personal" subtitle="Qué hizo cada administrador: revisiones, subsanaciones, emisiones y cierres."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">Desde<input type="date" className={`${inputCls} !w-auto !py-1.5`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-1.5">Hasta<input type="date" className={`${inputCls} !w-auto !py-1.5`} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        } />
      {!data ? <Spinner /> : (
        <>
          {/* Escritorio: tabla · Móvil: tarjetas */}
          <Card className="!p-0 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Persona</th>{COLS.map(([, l]) => <th key={l} className="px-3 py-3 text-right">{l}</th>)}<th className="px-4 py-3">Última actividad</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.staff.map((s) => (
                  <tr key={s.id} className={`cursor-pointer hover:bg-slate-50 ${userId === s.id ? 'bg-brand-50/60' : ''}`} onClick={() => setUserId(userId === s.id ? '' : s.id)}>
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{s.name || s.email}</div><div className="text-xs text-slate-500">{ROLE[s.role]} · {s.email}</div></td>
                    {COLS.map(([k]) => <td key={k} className={`px-3 py-3 text-right tabular-nums ${s[k] ? 'font-semibold text-slate-900' : 'text-slate-300'}`}>{String(s[k])}</td>)}
                    <td className="px-4 py-3 text-xs text-slate-500">{s.ultimaActividad ? fmtDate(s.ultimaActividad) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="grid gap-3 md:hidden">
            {data.staff.map((s) => (
              <button key={s.id} onClick={() => setUserId(userId === s.id ? '' : s.id)} className={`rounded-xl bg-white p-4 text-left shadow-sm ring-1 ${userId === s.id ? 'ring-brand-400' : 'ring-slate-200/80'}`}>
                <div className="font-medium text-slate-900">{s.name || s.email}</div>
                <div className="text-xs text-slate-500">{ROLE[s.role]} · última actividad {s.ultimaActividad ? fmtDate(s.ultimaActividad) : '—'}</div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {COLS.map(([k, l]) => <div key={k} className="rounded-lg bg-slate-50 p-2"><dd className="text-base font-semibold tabular-nums">{String(s[k])}</dd><dt className="text-[10px] leading-tight text-slate-500">{l}</dt></div>)}
                </dl>
              </button>
            ))}
          </div>

          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Historial de acciones</h2>
              {userId && <button onClick={() => setUserId('')} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">{data.staff.find((s) => s.id === userId)?.name} ✕</button>}
              <span className="ml-auto text-xs text-slate-500">Últimas 60 · haga clic en una persona para filtrar</span>
            </div>
            {data.feed.length === 0 ? <p className="text-sm text-slate-500">Sin actividad en el periodo.</p> : (
              <ol className="divide-y divide-slate-100">
                {data.feed.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDate(f.at)}</span>
                    <span className="font-medium text-slate-900">{f.actor}</span>
                    <span className="text-slate-500">pasó</span>
                    <Link to={`/admin/solicitud/${f.requestId}`} className="font-mono text-brand-700 hover:underline">{f.code}</Link>
                    <span className="text-slate-500">a</span>
                    <StatusBadge status={f.to} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={f.tramite}>{f.tramite}{f.reason ? ` · ${f.reason}` : ''}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
