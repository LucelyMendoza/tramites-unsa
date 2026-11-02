import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { STATUS_LABEL, STATUS_STYLE, type Status } from './types';

const STATUS_DOT: Record<Status, string> = {
  BORRADOR: 'bg-slate-400',
  ENVIADA: 'bg-sky-500',
  EN_REVISION: 'bg-indigo-500',
  REQUIERE_SUBSANACION: 'bg-amber-500',
  REENVIADA: 'bg-violet-500',
  EN_TRAMITE: 'bg-blue-500',
  EMITIDA: 'bg-emerald-500',
  FINALIZADA: 'bg-green-600',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-black/5 ${STATUS_STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function BrandMark({ className = 'h-9 w-9', inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl font-bold tracking-tight ${inverted ? 'bg-white text-brand-800' : 'bg-brand-700 text-white'} ${className}`}>
      U
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' };
export function Button({ variant = 'primary', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800',
    secondary: 'bg-white text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
    ghost: 'text-brand-700 hover:bg-brand-50',
  }[variant];
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6 ${className}`}>{children}</section>
);

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
export const inputCls =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500';

export const Alert = ({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) => {
  const c = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200 border-sky-400',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200 border-amber-400',
    error: 'bg-red-50 text-red-800 ring-red-200 border-red-500',
    ok: 'bg-emerald-50 text-emerald-900 ring-emerald-200 border-emerald-500',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : undefined} className={`rounded-lg border-l-4 p-3.5 text-sm ring-1 ring-inset ${c}`}>{children}</div>;
};

export const Spinner = () => (
  <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />
    Cargando…
  </div>
);

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>{total} resultado(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <span className="px-1 tabular-nums">Página {page} de {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
