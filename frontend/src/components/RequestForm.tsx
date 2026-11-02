import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, fmtSize, uploadFile } from '../api';
import { useAuth } from '../auth';
import type { Catalog, Detail, DocDef, FieldDef, TramiteType } from '../types';
import { Alert, Button, Card, Field, inputCls, Spinner } from '../ui';

const MIME: Record<string, string[]> = { pdf: ['application/pdf'], jpg: ['image/jpeg'], png: ['image/png'] };
const EXT: Record<string, string> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG' };
const STEPS = ['Datos', 'Documentos', 'Revisión'];

interface Form {
  applicantType: 'estudiante' | 'egresado';
  apellidosNombres: string; dni: string; cui: string;
  facultyId: string; schoolId: string; tramiteTypeId: string;
  typeData: Record<string, any>;
}

export default function RequestForm({ initial, onSent }: { initial?: Detail; onSent(r: { id: string; code: string; resubmit: boolean }): void }) {
  const { me } = useAuth();
  const correction = initial?.status === 'REQUIERE_SUBSANACION';
  const [cat, setCat] = useState<Catalog | null>(null);
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(initial ?? null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declaration, setDeclaration] = useState(false);
  const [form, setForm] = useState<Form>(() => ({
    applicantType: initial?.applicantType ?? me?.applicantType ?? 'estudiante',
    apellidosNombres: initial?.apellidosNombres ?? me?.name ?? '', dni: initial?.dni ?? '', cui: initial?.cui ?? '',
    facultyId: initial?.facultyId ?? '', schoolId: initial?.schoolId ?? '',
    tramiteTypeId: initial?.tramiteTypeId ?? '', typeData: (initial?.typeData as Record<string, any>) ?? {},
  }));

  useEffect(() => { api<Catalog>('GET', '/api/catalog').then(setCat).catch((e) => setErr(e.message)); }, []);

  const type: TramiteType | undefined = cat?.tramiteTypes.find((t) => t.id === form.tramiteTypeId);
  const editable = initial?.editable;
  const canEdit = (key: string) => !correction || !!editable?.all || !!editable?.fields.includes(key);
  const canReplace = (slot: string) => !correction || !!editable?.all || !!editable?.files.includes(slot);

  const schools = useMemo(() => cat?.schools.filter((s) => s.facultyId === form.facultyId) ?? [], [cat, form.facultyId]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const groups = useMemo(() => {
    const m = new Map<string, TramiteType[]>();
    cat?.tramiteTypes.forEach((t) => m.set(t.group, [...(m.get(t.group) ?? []), t]));
    return [...m.entries()];
  }, [cat]);

  const refresh = async (rid: string) => setDetail(await api<Detail>('GET', `/api/requests/${rid}`));

  const handle = (e: unknown) => {
    if (e instanceof ApiError) {
      setErr(e.message);
      if (e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.details)) flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
        setErrors(flat);
      }
    } else setErr('Error inesperado');
  };

  const body = () => ({ ...form, programId: null });

  async function saveData() {
    setBusy(true); setErr(null); setErrors({});
    try {
      if (id) await api('PUT', `/api/requests/${id}`, body());
      else {
        const r = await api<{ id: string }>('POST', '/api/requests', body());
        setId(r.id);
        await refresh(r.id);
        setStep(1);
        return;
      }
      await refresh(id);
      setStep(1);
    } catch (e) { handle(e); } finally { setBusy(false); }
  }

  async function onFile(doc: DocDef, file: File | undefined) {
    if (!file || !id) return;
    setErr(null);
    const kind = file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg') ?? '';
    const limit = Math.min(doc.maxMb ?? 99, 5);
    if (!doc.kinds.includes(kind as never) || !MIME[kind]?.includes(file.type)) return setErr(`${doc.label}: formato no permitido. Use ${doc.kinds.map((k) => EXT[k]).join(', ')}.`);
    if (file.size > limit * 1024 * 1024) return setErr(`${doc.label}: el archivo excede ${limit} MB.`);
    setBusy(true);
    try { await uploadFile(id, doc.slot, file); await refresh(id); } catch (e) { handle(e); } finally { setBusy(false); }
  }

  async function submit() {
    if (!id) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ code: string }>('POST', `/api/requests/${id}/submit`, type?.requiresDeclaration && !correction ? { declarationAccepted: declaration } : {});
      onSent({ id, code: r.code ?? detail?.code ?? '', resubmit: correction });
    } catch (e) { handle(e); } finally { setBusy(false); }
  }

  if (!cat) return err ? <Alert kind="error">{err}</Alert> : <Spinner />;
  const docs = type?.requiredDocs ?? detail?.config.requiredDocs ?? [];
  const current = (slot: string) => detail?.files.find((f) => f.slot === slot && f.isCurrent);
  const allDocs = docs.every((d) => current(d.slot));
  const faculty = cat.faculties.find((f) => f.id === form.facultyId)?.name;
  const school = cat.schools.find((s) => s.id === form.schoolId)?.name;

  return (
    <div className="space-y-4">
      <ol className="flex gap-2 text-xs sm:text-sm" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex-1 rounded-md px-3 py-2 text-center ${i === step ? 'bg-brand-600 font-semibold text-white' : i < step ? 'bg-brand-100 text-brand-900' : 'bg-slate-100 text-slate-500'}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      {correction && <Alert kind="warn">Subsanación: solo puede modificar lo observado por la unidad administrativa. Lo demás aparece bloqueado.</Alert>}
      {err && <Alert kind="error">{err}</Alert>}

      {step === 0 && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de solicitante">
              <div className="flex gap-4 py-2 text-sm">
                {(['estudiante', 'egresado'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2"><input type="radio" name="at" checked={form.applicantType === t} disabled={correction} onChange={() => set('applicantType', t)} />{t === 'estudiante' ? 'Estudiante' : 'Egresado'}</label>
                ))}
              </div>
            </Field>
            <Field label="Tipo de trámite *" error={errors.tramiteTypeId} htmlFor="tt">
              <select id="tt" className={inputCls} value={form.tramiteTypeId} disabled={correction} onChange={(e) => setForm((f) => ({ ...f, tramiteTypeId: e.target.value, typeData: {} }))}>
                <option value="">Seleccione…</option>
                {groups.map(([g, ts]) => <optgroup key={g} label={g}>{ts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Apellidos y Nombres" error={errors.apellidosNombres} htmlFor="nm" hint={me?.name ? 'Tomado de su cuenta institucional. Si no es correcto, solicite la corrección a la OTI.' : undefined}>
                <input id="nm" className={`${inputCls} ${me?.name ? '!bg-slate-100 text-slate-700 cursor-not-allowed' : ''}`} value={me?.name || form.apellidosNombres} readOnly={!!me?.name} aria-readonly={!!me?.name}
                  disabled={correction} onChange={(e) => !me?.name && set('apellidosNombres', e.target.value)} autoComplete="name" />
              </Field>
            </div>
            <Field label="DNI *" error={errors.dni} hint="8 dígitos" htmlFor="dni">
              <input id="dni" inputMode="numeric" maxLength={8} className={inputCls} value={form.dni} disabled={!canEdit('dni')} onChange={(e) => set('dni', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="CUI *" error={errors.cui} hint="Código Único de Identificación" htmlFor="cui">
              <input id="cui" inputMode="numeric" className={inputCls} value={form.cui} disabled={!canEdit('cui')} onChange={(e) => set('cui', e.target.value.trim())} />
            </Field>
            <Field label="Facultad *" error={errors.facultyId} htmlFor="fac">
              <select id="fac" className={inputCls} value={form.facultyId} disabled={!canEdit('faculty_id')} onChange={(e) => setForm((f) => ({ ...f, facultyId: e.target.value, schoolId: '' }))}>
                <option value="">Seleccione…</option>
                {cat.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Escuela profesional *" error={errors.schoolId} htmlFor="sch">
              <select id="sch" className={inputCls} value={form.schoolId} disabled={!form.facultyId || !canEdit('school_id')} onChange={(e) => setForm((f) => ({ ...f, schoolId: e.target.value }))}>
                <option value="">Seleccione…</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {type?.fields.map((f) => (
              <div key={f.key} className="sm:col-span-2">
                <DynamicField def={f} value={form.typeData[f.key]} error={errors[`typeData.${f.key}`]} disabled={!canEdit(`td.${f.key}`)} onChange={(v) => setForm((x) => ({ ...x, typeData: { ...x.typeData, [f.key]: v } }))} />
              </div>
            ))}
          </div>
          {type?.description && <p className="mt-4 text-xs text-slate-500">{type.description}</p>}
          <div className="mt-5 flex justify-end">
            <Button disabled={busy || !form.tramiteTypeId} onClick={saveData}>{busy ? 'Guardando…' : 'Guardar y continuar'}</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <h2 className="mb-1 text-base font-semibold">Documentos adjuntos</h2>
          <p className="mb-4 text-xs text-slate-500">Se valida el contenido real del archivo, no solo su extensión. Máximo 5 MB por archivo.</p>
          <div className="space-y-4">
            {docs.map((d) => {
              const f = current(d.slot);
              const versions = detail?.files.filter((x) => x.slot === d.slot).length ?? 0;
              return (
                <div key={d.slot} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{d.label} *</div>
                    <span className={`text-xs ${f ? 'text-emerald-700' : 'text-slate-500'}`}>{f ? '✔ Cargado y validado' : 'Pendiente'}</span>
                  </div>
                  {f && <p className="mt-1 text-xs text-slate-600">{f.originalName} · {fmtSize(f.sizeBytes)} · {f.contentType}{versions > 1 ? ` · versión ${f.version}` : ''}</p>}
                  {canReplace(d.slot) ? (
                    <label className="mt-2 inline-block">
                      <span className="sr-only">{f ? 'Reemplazar' : 'Seleccionar'} {d.label}</span>
                      <input type="file" disabled={busy} accept={d.kinds.flatMap((k) => MIME[k]).join(',')} onChange={(e) => { onFile(d, e.target.files?.[0]); e.target.value = ''; }}
                        className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" />
                    </label>
                  ) : <p className="mt-2 text-xs text-slate-500">Este documento no fue observado; no se puede reemplazar.</p>}
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(0)}>Atrás</Button>
            <Button disabled={busy || !allDocs} onClick={() => setStep(2)}>Continuar</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="mb-3 text-base font-semibold">Revise antes de {correction ? 'reenviar' : 'confirmar'}</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Trámite" v={type?.name} /><Row k="Solicitante" v={form.applicantType === 'estudiante' ? 'Estudiante' : 'Egresado'} />
            <Row k="Apellidos y Nombres" v={form.apellidosNombres} /><Row k="DNI" v={form.dni} /><Row k="CUI" v={form.cui} />
            <Row k="Facultad" v={faculty} /><Row k="Escuela" v={school} />
            {type?.fields.map((f) => <Row key={f.key} k={f.label} v={Array.isArray(form.typeData[f.key]) ? (f.type === 'multi-select' ? f.options.filter((o) => form.typeData[f.key].includes(o)) : [...form.typeData[f.key]].sort()).join(', ') : form.typeData[f.key]} />)}
            {docs.map((d) => <Row key={d.slot} k={d.label} v={current(d.slot) ? `${current(d.slot)!.originalName} (${fmtSize(current(d.slot)!.sizeBytes)})` : '—'} />)}
          </dl>
          {type?.requiresDeclaration && !correction && (
            <label className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
              <input type="checkbox" className="mt-0.5" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
              <span>{type.declarationText ?? 'Declaro que cuento con la autorización de la Unidad de Posgrado correspondiente para realizar este trámite'}
                <span className="mt-1 block text-xs text-amber-900/80">Se registrará su aceptación (fecha, usuario y versión del texto). La autorización será verificada posteriormente por el área responsable.</span></span>
            </label>
          )}
          <div className="mt-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>Atrás</Button>
            <Button disabled={busy || (!!type?.requiresDeclaration && !correction && !declaration)} onClick={submit}>{busy ? 'Enviando…' : correction ? 'Reenviar subsanación' : 'Confirmar y enviar'}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v?: string | null }) => (
  <div><dt className="text-xs text-slate-500">{k}</dt><dd className="break-words font-medium">{v || '—'}</dd></div>
);

function DynamicField({ def, value, error, disabled, onChange }: { def: FieldDef; value: any; error?: string; disabled: boolean; onChange(v: any): void }) {
  if (def.type === 'multi-year') {
    const now = new Date().getFullYear();
    const years = Array.from({ length: def.yearsBack }, (_, i) => now - i);
    const sel: number[] = Array.isArray(value) ? value : [];
    return (
      <Field label={`${def.label}${def.required ? ' *' : ''}`} error={error} hint={`Seleccione hasta ${def.maxSelect} año(s)`}>
        <div className="flex flex-wrap gap-2">
          {years.map((y) => (
            <label key={y} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ${sel.includes(y) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-300'} ${disabled ? 'opacity-50' : ''}`}>
              <input type="checkbox" className="sr-only" disabled={disabled} checked={sel.includes(y)}
                onChange={() => onChange(sel.includes(y) ? sel.filter((x) => x !== y) : sel.length < def.maxSelect ? [...sel, y].sort() : sel)} />{y}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  if (def.type === 'multi-select') {
    const sel: string[] = Array.isArray(value) ? value : [];
    const toggle = (o: string) => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : sel.length < def.maxSelect ? def.options.filter((x) => x === o || sel.includes(x)) : sel);
    return (
      <Field label={`${def.label}${def.required ? ' *' : ''}`} error={error} hint="Marque uno o más años académicos">
        <div className="flex flex-wrap gap-2" role="group" aria-label={def.label}>
          {def.options.map((o) => (
            <label key={o} className={`min-w-12 cursor-pointer rounded-lg px-3.5 py-2 text-center text-sm font-medium ring-1 ring-inset transition ${sel.includes(o) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
              <input type="checkbox" className="sr-only" disabled={disabled} checked={sel.includes(o)} onChange={() => toggle(o)} />{o}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  if (def.type === 'receipt')
    return (
      <Field label={`${def.label}${def.required ? ' *' : ''}`} error={error} hint="Escríbalo tal como figura en la boleta que adjuntará (p. ej. B001-000123). Cada boleta sustenta un solo trámite.">
        <input className={`${inputCls} font-mono uppercase tracking-wide`} disabled={disabled} maxLength={30} placeholder="B001-000123" autoComplete="off"
          value={value ?? ''} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </Field>
    );
  if (def.type === 'select')
    return (
      <Field label={`${def.label}${def.required ? ' *' : ''}`} error={error}>
        <select className={inputCls} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Seleccione…</option>{def.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </Field>
    );
  return (
    <Field label={`${def.label}${def.required ? ' *' : ''}`} error={error}>
      <input className={inputCls} disabled={disabled} maxLength={def.maxLength} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
