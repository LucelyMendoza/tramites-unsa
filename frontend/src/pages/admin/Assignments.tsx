import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Alert, Button, Card, inputCls, PageHeader, Spinner } from '../../ui';

interface Person { id: string; email: string; name: string }
interface Rule { tramiteTypeId: string; code: string; name: string; group: string; assignee: Person | null }
interface Staff extends Person {
  role: 'superadmin' | 'reviewer' | 'issuer';
  absence: { from: string; until: string | null; note: string | null; active: boolean; substitute: Person | null } | null;
  openCount: number; rulesCount: number;
}
const ROLE = { superadmin: 'Superadministrador', reviewer: 'Revisor', issuer: 'Emisor' } as const;
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d?: string | null) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const who = (p?: Person | null) => (p ? p.name || p.email : '—');

export default function AdminAssignments() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api<Rule[]>('GET', '/api/admin/assignment-rules'), api<Staff[]>('GET', '/api/admin/availability')]);
      setRules(r); setStaff(s);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (msg: string | ((r: any) => string), fn: () => Promise<any>) => {
    setBusy(true); setErr(null); setOk(null);
    try { const r = await fn(); setOk(typeof msg === 'function' ? msg(r) : msg); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>();
    rules?.forEach((r) => m.set(r.group, [...(m.get(r.group) ?? []), r]));
    return [...m.entries()];
  }, [rules]);

  if (!rules) return err ? <Alert kind="error">{err}</Alert> : <Spinner />;
  const awayIds = new Set(staff.filter((s) => s.absence?.active).map((s) => s.id));

  return (
    <div>
      <PageHeader title="Responsables" subtitle="Quién atiende cada tipo de trámite y quién cubre a quien está de vacaciones." />
      {err && <div className="mb-4"><Alert kind="error">{err}</Alert></div>}
      {ok && <div className="mb-4"><Alert kind="ok">{ok}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        {/* Reglas */}
        <Card className="!p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Responsable por tipo de trámite</h2>
            <p className="mt-1 text-xs text-slate-500">Cada solicitud enviada se asigna automáticamente y se avisa por correo. Si el responsable está ausente, va a su suplente.</p>
          </div>
          {groups.map(([g, rs]) => (
            <div key={g}>
              <div className="bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g}</div>
              <ul className="divide-y divide-slate-100">
                {rs.map((r) => (
                  <li key={r.tramiteTypeId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-[12rem] flex-1 text-sm text-slate-800">{r.name}</div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      {r.assignee && awayIds.has(r.assignee.id) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">de vacaciones</span>}
                      <select className={`${inputCls} sm:!w-60`} disabled={busy} value={r.assignee?.id ?? ''} aria-label={`Responsable de ${r.name}`}
                        onChange={(e) => run(`Responsable de «${r.name}» actualizado`, () => api('PUT', `/api/admin/assignment-rules/${r.tramiteTypeId}`, { assigneeId: e.target.value || null, reassignUnassigned: true }))}>
                        <option value="">Sin responsable (bandeja general)</option>
                        {staff.filter((s) => s.role !== 'issuer' || s.id === r.assignee?.id).map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        {/* Personal */}
        <Card className="!p-0 self-start">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Personal y ausencias</h2>
            <p className="mt-1 text-xs text-slate-500">Registre vacaciones o licencias: lo pendiente pasa al suplente y lo nuevo no se acumula en quien está ausente.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {staff.map((s) => (
              <li key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                    {(s.name || s.email).split(/[\s@.]+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{s.name || s.email}</div>
                    <div className="truncate text-xs text-slate-500">{s.email} · {ROLE[s.role]}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s.openCount} abiertas</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s.rulesCount} trámite(s) a cargo</span>
                      {s.absence && (
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${s.absence.active ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-sky-50 text-sky-800 ring-sky-200'}`}>
                          {s.absence.active ? 'Ausente' : 'Ausencia programada'}: {fmt(s.absence.from)} – {fmt(s.absence.until)} · suplente {who(s.absence.substitute)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {s.absence
                      ? <Button variant="secondary" disabled={busy} onClick={() => run(`Ausencia de ${s.name || s.email} finalizada`, () => api('DELETE', `/api/admin/availability/${s.id}/absence`))}>Finalizar ausencia</Button>
                      : <Button variant="secondary" disabled={busy} onClick={() => setEditing(editing === s.id ? null : s.id)}>Registrar ausencia</Button>}
                  </div>
                </div>
                {editing === s.id && !s.absence && (
                  <AbsenceForm person={s} staff={staff} busy={busy} onCancel={() => setEditing(null)}
                    onSave={(b) => run((r) => `Ausencia registrada.${r.startsToday ? ` ${r.moved} solicitud(es) pasaron al suplente${r.unassigned ? ` y ${r.unassigned} quedaron en la bandeja general (sin alcance)` : ''}.` : ' Se aplicará desde la fecha de inicio.'}`,
                      async () => { const r = await api('PUT', `/api/admin/availability/${s.id}/absence`, b); setEditing(null); return r; })} />
                )}
                {s.openCount > 0 && <ReassignRow person={s} staff={staff} busy={busy}
                  onGo={(to) => run((r) => `${r.moved} solicitud(es) reasignada(s)${r.unassigned ? `; ${r.unassigned} a la bandeja general` : ''}.`, () => api('POST', `/api/admin/availability/${s.id}/reassign`, { toUserId: to || null }))} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AbsenceForm({ person, staff, busy, onSave, onCancel }: { person: Staff; staff: Staff[]; busy: boolean; onSave(b: object): void; onCancel(): void }) {
  const [from, setFrom] = useState(today());
  const [until, setUntil] = useState('');
  const [sub, setSub] = useState('');
  const [note, setNote] = useState('Vacaciones');
  const [move, setMove] = useState(true);
  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-700">Desde<input type="date" className={`${inputCls} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs font-medium text-slate-700">Hasta (inclusive)<input type="date" className={`${inputCls} mt-1`} value={until} min={from} onChange={(e) => setUntil(e.target.value)} /></label>
        <label className="text-xs font-medium text-slate-700 sm:col-span-2">Suplente
          <select className={`${inputCls} mt-1`} value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">Sin suplente (lo nuevo va a la bandeja general)</option>
            {staff.filter((x) => x.id !== person.id && !x.absence?.active).map((x) => <option key={x.id} value={x.id}>{x.name || x.email}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700 sm:col-span-2">Motivo (opcional)<input className={`${inputCls} mt-1`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
          Pasar también sus {person.openCount} solicitud(es) abiertas al suplente (si la ausencia empieza hoy)
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button disabled={busy || !until || until < from} onClick={() => onSave({ from, until, substituteId: sub || null, note: note || undefined, reassignOpen: move })}>Guardar ausencia</Button>
      </div>
    </div>
  );
}

function ReassignRow({ person, staff, busy, onGo }: { person: Staff; staff: Staff[]; busy: boolean; onGo(to: string): void }) {
  const [to, setTo] = useState('');
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>Reasignar sus {person.openCount} abiertas a</span>
      <select className={`${inputCls} !w-auto !py-1.5 text-xs`} value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Bandeja general</option>
        {staff.filter((x) => x.id !== person.id && !x.absence?.active).map((x) => <option key={x.id} value={x.id}>{x.name || x.email}</option>)}
      </select>
      <Button variant="ghost" className="!px-2 !py-1 !text-xs" disabled={busy} onClick={() => onGo(to)}>Reasignar</Button>
    </div>
  );
}
