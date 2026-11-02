import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { BrandMark } from '../ui';

interface TypeCount { tramiteTypeId: string; name: string; group: string; abiertas: number }
const ROLE_LABEL = { superadmin: 'Superadministrador', reviewer: 'Revisor', issuer: 'Emisor' } as const;

const Icon = ({ d }: { d: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  users: 'M16 11a4 4 0 1 0-8 0M3 21a9 9 0 0 1 18 0',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
};

export default function AdminLayout() {
  const { me, config, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(() => new URLSearchParams(loc.search).get('q') ?? '');
  const [types, setTypes] = useState<TypeCount[]>([]);
  const [typesOpen, setTypesOpen] = useState(true);
  const perms = me?.staff?.permissions ?? [];

  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => { api<TypeCount[]>('GET', '/api/admin/reports/by-type').then(setTypes).catch(() => {}); }, [loc.pathname, loc.search]);

  const here = loc.pathname + loc.search;
  const Item = ({ to, icon, children, badge, exact = true, wrap = false }: { to: string; icon?: string; children: ReactNode; badge?: number; exact?: boolean; wrap?: boolean }) => {
    const active = exact ? here === to || (to === '/admin' && here === '/admin/') : here.startsWith(to);
    return (
      <Link to={to} aria-current={active ? 'page' : undefined}
        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
        {icon && <span className={active ? 'text-brand-700' : 'text-slate-400 group-hover:text-slate-600'}><Icon d={icon} /></span>}
        <span className={`min-w-0 flex-1 ${wrap ? 'line-clamp-2 text-[13px] leading-snug' : 'truncate'}`}>{children}</span>
        {!!badge && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{badge}</span>}
      </Link>
    );
  };
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="mt-5">
      <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
  const groups = [...new Set(types.map((t) => t.group))];

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <BrandMark />
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-slate-900">Trámites UNSA</span>
          <span className="block text-xs text-slate-500">Panel administrativo</span>
        </span>
        <button className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><Icon d={I.close} /></button>
      </div>
      <form className="px-3" role="search" onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/admin?q=${encodeURIComponent(q.trim())}` : '/admin'); }}>
        <label className="relative block">
          <span className="sr-only">Buscar solicitudes</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon d={I.search} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, DNI, CUI, boleta…"
            className="w-full rounded-lg border-0 bg-slate-100 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </label>
      </form>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Menú del panel">
        <Section title="Bandeja">
          <Item to="/admin" icon={I.inbox}>Todas las solicitudes</Item>
          {me && <Item to={`/admin?assignedTo=${me.id}`} icon={I.me}>Asignadas a mí</Item>}
          <Item to="/admin/tramites" icon={I.grid}>Resumen por trámite</Item>
        </Section>
        {types.length > 0 && (
          <div className="mt-5">
            <button onClick={() => setTypesOpen(!typesOpen)} aria-expanded={typesOpen}
              className="flex w-full items-center px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
              Tipos de trámite
              <span className={`ml-auto transition ${typesOpen ? 'rotate-90' : ''}`}><Icon d={I.chevron} /></span>
            </button>
            {typesOpen && groups.map((g) => (
              <div key={g} className="mb-2">
                <div className="px-3 pt-1 text-[11px] text-slate-400">{g}</div>
                {types.filter((t) => t.group === g).map((t) => (
                  <Item key={t.tramiteTypeId} to={`/admin?tramiteTypeId=${t.tramiteTypeId}`} badge={t.abiertas} wrap>
                    <span title={t.name}>{t.name}</span>
                  </Item>
                ))}
              </div>
            ))}
          </div>
        )}
        <Section title="Reportes">
          <Item to="/admin/estadisticas" icon={I.chart}>Estadísticas</Item>
          {perms.includes('report:export') && <Item to="/admin/actividad" icon={I.pulse}>Actividad del personal</Item>}
        </Section>
        {(perms.includes('assignment:manage') || perms.includes('catalog:manage') || perms.includes('audit:view')) && (
          <Section title="Administración">
            {perms.includes('assignment:manage') && <Item to="/admin/responsables" icon={I.users}>Responsables y ausencias</Item>}
            {perms.includes('catalog:manage') && <Item to="/admin/catalogo" icon={I.book}>Catálogo</Item>}
            {perms.includes('audit:view') && <Item to="/admin/sistema" icon={I.shield}>Auditoría y correos</Item>}
          </Section>
        )}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {(me?.name || me?.email || '?').split(/[\s@.]+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-slate-900">{me?.name || me?.email}</span>
            <span className="block text-xs text-slate-500">{me?.staff ? ROLE_LABEL[me.staff.role] : ''}</span>
          </span>
          <button onClick={() => logout()} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Salir</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {config?.testMode && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900 ring-1 ring-amber-200 lg:pl-72">
          Entorno de pruebas · cuentas y datos ficticios · no ingrese datos personales reales
        </div>
      )}
      {/* Barra superior móvil */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-700 hover:bg-slate-100" aria-label="Abrir menú" aria-expanded={open}><Icon d={I.menu} /></button>
        <BrandMark className="h-8 w-8 text-sm" />
        <span className="text-sm font-semibold text-slate-900">Trámites UNSA</span>
      </header>
      {/* Menú lateral: fijo en escritorio, cajón en móvil */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
        {sidebar}
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <main className="px-4 py-6 sm:px-6 lg:ml-72 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl"><Outlet /></div>
      </main>
    </div>
  );
}
