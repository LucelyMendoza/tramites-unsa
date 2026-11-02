import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { STATUS_LABEL, type Status } from '../../types';
import { Alert, inputCls, PageHeader, Spinner } from '../../ui';

export interface TypeStats {
  tramiteTypeId: string; code: string; name: string; group: string;
  total: number; abiertas: number; sinAsignar: number; ultimos30: number; diasPromedio: number | null;
  porEstado: Record<Exclude<Status, 'BORRADOR'>, number>;
}
const CHIPS: [Exclude<Status, 'BORRADOR'>, string][] = [
  ['ENVIADA', 'bg-sky-50 text-sky-800'], ['EN_REVISION', 'bg-indigo-50 text-indigo-800'], ['REQUIERE_SUBSANACION', 'bg-amber-50 text-amber-900'],
  ['REENVIADA', 'bg-violet-50 text-violet-800'], ['EN_TRAMITE', 'bg-blue-50 text-blue-800'], ['EMITIDA', 'bg-emerald-50 text-emerald-800'], ['FINALIZADA', 'bg-green-50 text-green-900'],
];

export default function AdminTramites() {
  const [rows, setRows] = useState<TypeStats[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v)).toString();
    api<TypeStats[]>('GET', `/api/admin/reports/by-type${qs ? '?' + qs : ''}`).then(setRows).catch((e) => setErr(e.message));
  }, [from, to]);
  const groups = useMemo(() => [...new Set(rows?.map((r) => r.group) ?? [])], [rows]);
  const totals = useMemo(() => rows?.reduce((a, r) => ({ total: a.total + r.total, abiertas: a.abiertas + r.abiertas, sinAsignar: a.sinAsignar + r.sinAsignar }), { total: 0, abiertas: 0, sinAsignar: 0 }), [rows]);

  if (err) return <Alert kind="error">{err}</Alert>;
  return (
    <div>
      <PageHeader title="Resumen por trámite" subtitle="Cada tarjeta resume un tipo de solicitud. Haga clic para ver su bandeja."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">Desde<input type="date" className={`${inputCls} !w-auto !py-1.5`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-1.5">Hasta<input type="date" className={`${inputCls} !w-auto !py-1.5`} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        } />
      {!rows ? <Spinner /> : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-xl">
            {[['Solicitudes', totals!.total], ['Abiertas', totals!.abiertas], ['Sin responsable', totals!.sinAsignar]].map(([l, n]) => (
              <div key={l} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{n}</div><div className="text-xs text-slate-500">{l}</div>
              </div>
            ))}
          </div>
          {groups.map((g) => (
            <section key={g} className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.filter((r) => r.group === g).map((r) => (
                  <Link key={r.tramiteTypeId} to={`/admin?tramiteTypeId=${r.tramiteTypeId}`}
                    className="group flex flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300">
                    <div className="flex items-start gap-3">
                      <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-900 group-hover:text-brand-800">{r.name}</h3>
                      <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700">→</span>
                    </div>
                    <div className="mt-4 flex items-end gap-6">
                      <div><div className="text-3xl font-semibold tabular-nums text-slate-900">{r.abiertas}</div><div className="text-xs text-slate-500">abiertas</div></div>
                      <div><div className="text-lg font-semibold tabular-nums text-slate-700">{r.total}</div><div className="text-xs text-slate-500">en total</div></div>
                      <div><div className="text-lg font-semibold tabular-nums text-slate-700">{r.ultimos30}</div><div className="text-xs text-slate-500">últimos 30 días</div></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {CHIPS.filter(([s]) => r.porEstado[s] > 0).map(([s, cls]) => (
                        <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{STATUS_LABEL[s]} {r.porEstado[s]}</span>
                      ))}
                      {r.total === 0 && <span className="text-xs text-slate-400">Sin solicitudes en el periodo</span>}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-[11px] text-slate-500">
                      {r.diasPromedio != null && <span>Atención promedio: <b className="text-slate-700">{r.diasPromedio} días</b></span>}
                      {r.sinAsignar > 0 && <span className="font-medium text-amber-700">{r.sinAsignar} sin responsable</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
