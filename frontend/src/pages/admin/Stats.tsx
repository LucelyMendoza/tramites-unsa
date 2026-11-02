import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { BarChart } from '../../components/BarChart';
import { Alert, Card, inputCls, PageHeader, Spinner } from '../../ui';
import type { TypeStats } from './Tramites';

type Gran = 'month' | 'semester' | 'year';
interface Volume { granularity: Gran; periods: { key: string; label: string; solicitadas: number; finalizadas: number }[] }
const SERIES = [
  { key: 'solicitadas', name: 'Solicitadas', color: '#9b2c4b' },
  { key: 'finalizadas', name: 'Finalizadas', color: '#2a7fd0' },
];
const GRAN: [Gran, string, string][] = [['month', 'Mensual', 'últimos 12 meses'], ['semester', 'Semestral', 'últimos 6 semestres (A: ene–jun · B: jul–dic)'], ['year', 'Anual', 'últimos 5 años']];

export default function AdminStats() {
  const [gran, setGran] = useState<Gran>('month');
  const [typeId, setTypeId] = useState('');
  const [vol, setVol] = useState<Volume | null>(null);
  const [types, setTypes] = useState<TypeStats[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api<TypeStats[]>('GET', '/api/admin/reports/by-type').then(setTypes).catch(() => {}); }, []);
  useEffect(() => {
    setVol(null);
    api<Volume>('GET', `/api/admin/reports/volume?granularity=${gran}${typeId ? `&tramiteTypeId=${typeId}` : ''}`).then(setVol).catch((e) => setErr(e.message));
  }, [gran, typeId]);

  const sum = useMemo(() => vol?.periods.reduce((a, p) => ({ s: a.s + p.solicitadas, f: a.f + p.finalizadas }), { s: 0, f: 0 }), [vol]);
  const last = vol?.periods.at(-1), prev = vol?.periods.at(-2);
  const delta = last && prev && prev.solicitadas > 0 ? Math.round(((last.solicitadas - prev.solicitadas) / prev.solicitadas) * 100) : null;
  const ranking = useMemo(() => [...types].filter((t) => t.total > 0).sort((a, b) => b.total - a.total), [types]);
  const maxRank = Math.max(1, ...ranking.map((r) => r.total));

  if (err) return <Alert kind="error">{err}</Alert>;
  return (
    <div className="space-y-6">
      <PageHeader title="Estadísticas" subtitle="Cuántas solicitudes llegan y cuántas se cierran, por mes, semestre o año." />
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200" role="tablist" aria-label="Periodo">
          {GRAN.map(([g, l]) => (
            <button key={g} role="tab" aria-selected={gran === g} onClick={() => setGran(g)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${gran === g ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</button>
          ))}
        </div>
        <select className={`${inputCls} !w-auto max-w-full`} value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Tipo de trámite">
          <option value="">Todos los trámites</option>
          {types.map((t) => <option key={t.tramiteTypeId} value={t.tramiteTypeId}>{t.name}</option>)}
        </select>
      </div>

      {!vol ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Solicitadas', sum!.s, GRAN.find((g) => g[0] === gran)![2]],
              ['Finalizadas', sum!.f, 'en el mismo rango'],
              [`${last!.label}`, last!.solicitadas, delta == null ? 'periodo actual' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} % vs ${prev!.label}`],
              ['Promedio por periodo', Math.round((sum!.s / vol.periods.length) * 10) / 10, 'solicitudes'],
            ].map(([l, n, sub]) => (
              <div key={String(l)} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
                <div className="text-xs font-medium text-slate-500">{l}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{n}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>
          <Card>
            <h2 className="mb-1 text-base font-semibold text-slate-900">Solicitudes por {gran === 'month' ? 'mes' : gran === 'semester' ? 'semestre' : 'año'}</h2>
            <p className="mb-4 text-xs text-slate-500">Fecha de envío y de finalización en hora de Lima.</p>
            <BarChart title="Solicitudes por periodo" series={SERIES} groups={vol.periods.map((p) => ({ label: p.label, values: { solicitadas: p.solicitadas, finalizadas: p.finalizadas } }))} />
          </Card>
        </>
      )}

      <Card>
        <h2 className="mb-1 text-base font-semibold text-slate-900">¿Qué trámites se piden más?</h2>
        <p className="mb-4 text-xs text-slate-500">Total histórico por tipo de trámite.</p>
        {ranking.length === 0 ? <p className="text-sm text-slate-500">Aún no hay solicitudes.</p> : (
          <ul className="space-y-2.5">
            {ranking.map((r) => (
              <li key={r.tramiteTypeId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[16rem_minmax(0,1fr)_3rem]">
                <span className="truncate text-sm text-slate-700" title={r.name}>{r.name}</span>
                <span className="order-3 col-span-2 h-2.5 rounded-full bg-slate-100 sm:order-none sm:col-span-1">
                  <span className="block h-full rounded-full" style={{ width: `${(r.total / maxRank) * 100}%`, background: '#9b2c4b' }} />
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{r.total}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
