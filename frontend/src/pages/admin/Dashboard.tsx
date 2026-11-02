import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadCsv, fmtDate } from '../../api';
import { useAuth } from '../../auth';
import { STATUS_LABEL, STATUS_STYLE, type Catalog, type Status } from '../../types';
import { Alert, Button, Card, inputCls, Pager, Spinner, StatusBadge } from '../../ui';

interface Stats { total: number; nuevas: number; pendientesRevision: number; requierenSubsanacion: number; reenviadas: number; enTramite: number; documentosEmitidos: number; finalizados: number }
interface Item { id: string; code: string; status: Status; apellidosNombres: string; dni: string; cui: string; facultyName: string; schoolName: string; tramiteName: string; submittedAt: string; assignedEmail: string | null; resubmitCount: number }
const EMPTY = { status: '', facultyId: '', schoolId: '', tramiteTypeId: '', assignedTo: '', from: '', to: '', q: '' };

export default function Dashboard() {
  const { me } = useAuth();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [params] = useSearchParams();
  const fromUrl = useCallback(() => ({ ...EMPTY, ...Object.fromEntries([...params].filter(([k]) => k in EMPTY)) }), [params]);
  const [f, setF] = useState(fromUrl);
  const [applied, setApplied] = useState(fromUrl);
  // El menú lateral navega con ?q=, ?tramiteTypeId= o ?assignedTo=: se aplican al instante.
  useEffect(() => { const x = fromUrl(); setF(x); setApplied(x); setPage(1); }, [fromUrl]);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [data, setData] = useState<{ total: number; pageSize: number; items: Item[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const qs = useCallback((x: typeof EMPTY) => new URLSearchParams(Object.entries(x).filter(([, v]) => v)).toString(), []);
  useEffect(() => { api<Catalog>('GET', '/api/catalog').then(setCat).catch(() => {}); }, []);
  useEffect(() => {
    setErr(null);
    api<Stats>('GET', `/api/admin/stats?${qs({ ...applied, status: '', q: '' })}`).then(setStats).catch((e) => setErr(e.message));
    api('GET', `/api/admin/requests?${qs(applied)}&page=${page}&pageSize=20`).then(setData).catch((e) => setErr(e.message));
  }, [applied, page, qs]);

  const schools = cat?.schools.filter((s) => !f.facultyId || s.facultyId === f.facultyId) ?? [];
  const cards: [string, number | undefined, string][] = stats
    ? [['Total', stats.total, ''], ['Nuevas', stats.nuevas, 'ENVIADA'], ['Pend. de revisión', stats.pendientesRevision, ''], ['Requieren subsanación', stats.requierenSubsanacion, 'REQUIERE_SUBSANACION'], ['Reenviadas', stats.reenviadas, 'REENVIADA'], ['En trámite', stats.enTramite, 'EN_TRAMITE'], ['Doc. emitidos', stats.documentosEmitidos, ''], ['Finalizados', stats.finalizados, 'FINALIZADA']]
    : [];
  const apply = (x: typeof EMPTY) => { setPage(1); setApplied(x); };
  const canExport = me?.staff?.permissions.includes('report:export');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{applied.assignedTo && applied.assignedTo === me?.id ? 'Asignadas a mí' : applied.tramiteTypeId ? cat?.tramiteTypes.find((t) => t.id === applied.tramiteTypeId)?.name ?? 'Solicitudes' : 'Solicitudes'}</h1>
          {(applied.q || applied.tramiteTypeId || applied.assignedTo) && <p className="mt-1 text-sm text-slate-600">{applied.q ? <>Resultados para «{applied.q}» · </> : null}<Link to="/admin" className="text-brand-700 hover:underline">ver todas</Link></p>}
        </div>
        {me?.staff?.scope && <span className="text-xs text-slate-500">Alcance limitado a {me.staff.scope.length} facultad(es)</span>}
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {!stats ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map(([label, n, st]) => (
            <button key={label} disabled={!st} onClick={() => { const x = { ...f, status: st }; setF(x); apply(x); }} className="rounded-lg bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 enabled:hover:ring-brand-600">
              <div className="text-2xl font-semibold">{n}</div><div className="text-xs text-slate-500">{label}</div>
            </button>
          ))}
        </div>
      )}
      <button onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}
        className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 md:hidden">
        Filtros y búsqueda <span>{showFilters ? '▴' : '▾'}</span>
      </button>
      <Card className={showFilters ? '' : 'hidden md:block'}>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); apply(f); }}>
          <input className={`${inputCls} lg:col-span-2`} placeholder="Buscar: código, nombre, DNI, CUI o N.° de boleta" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Buscar" />
          <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== 'BORRADOR').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className={inputCls} value={f.tramiteTypeId} onChange={(e) => setF({ ...f, tramiteTypeId: e.target.value })} aria-label="Tipo de trámite">
            <option value="">Todos los trámites</option>{cat?.tramiteTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={inputCls} value={f.facultyId} onChange={(e) => setF({ ...f, facultyId: e.target.value, schoolId: '' })} aria-label="Facultad">
            <option value="">Todas las facultades</option>{cat?.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className={inputCls} value={f.schoolId} onChange={(e) => setF({ ...f, schoolId: e.target.value })} aria-label="Escuela">
            <option value="">Todas las escuelas</option>{schools.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div className="flex min-w-0 gap-2 lg:col-span-2"><input type="date" className={`${inputCls} min-w-0`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" /><input type="date" className={`${inputCls} min-w-0`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" /></div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Filtrar</Button>
            <Button type="button" variant="secondary" onClick={() => { setF(EMPTY); apply(EMPTY); }}>Limpiar</Button>
            {canExport && <Button type="button" variant="secondary" className="ml-auto" onClick={() => downloadCsv(`/api/admin/requests/export.csv?${qs(applied)}`, 'solicitudes.csv').catch((e) => setErr(e.message))}>Exportar CSV</Button>}
          </div>
        </form>
      </Card>
      {/* Móvil: tarjetas */}
      {data && (
        <div className="grid gap-3 md:hidden">
          {data.items.map((r) => (
            <Link key={r.id} to={`/admin/solicitud/${r.id}`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex items-start justify-between gap-2"><span className="font-mono text-sm text-brand-700">{r.code}</span><StatusBadge status={r.status} /></div>
              <div className="mt-1.5 text-sm font-medium text-slate-900">{r.apellidosNombres}</div>
              <div className="text-xs text-slate-500">{r.tramiteName}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-slate-500"><span>{fmtDate(r.submittedAt)}</span><span>{r.assignedEmail ?? 'Sin responsable'}</span></div>
            </Link>
          ))}
          {data.items.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Sin resultados.</p>}
        </div>
      )}
      <Card className="!p-0 hidden overflow-x-auto md:block">
        {!data ? <Spinner /> : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Solicitante</th><th className="px-3 py-2">Trámite</th><th className="px-3 py-2">Facultad / Escuela</th><th className="px-3 py-2">Enviada</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Asignado</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono"><Link className="text-brand-700 hover:underline" to={`/admin/solicitud/${r.id}`}>{r.code}</Link></td>
                  <td className="px-3 py-2">{r.apellidosNombres}<div className="text-xs text-slate-500">DNI {r.dni} · CUI {r.cui}</div></td>
                  <td className="px-3 py-2">{r.tramiteName}</td>
                  <td className="px-3 py-2 text-xs">{r.facultyName}<div className="text-slate-500">{r.schoolName}</div></td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.submittedAt)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>{r.resubmitCount > 0 && <span className="ml-1 text-xs text-slate-500">↻{r.resubmitCount}</span>}</td>
                  <td className="px-3 py-2 text-xs">{r.assignedEmail ?? '—'}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Sin resultados.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <p className="text-xs text-slate-500"><StatusBadge status="ENVIADA" /> La exportación CSV no incluye DNI, CUI ni nombres.</p>
    </div>
  );
}
