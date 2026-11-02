import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Alert, Button, Card, inputCls, Spinner } from '../../ui';

interface T { id: string; code: string; name: string; groupLabel: string; description: string; active: boolean; sortOrder: number; version: number; config: any }

export default function Catalog() {
  const [types, setTypes] = useState<T[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; code: string; name: string; groupLabel: string; description: string; active: boolean; sortOrder: number; config: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = () => api<T[]>('GET', '/api/admin/tramite-types').then(setTypes).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit) return;
    setErr(null); setOk(null);
    try {
      const config = JSON.parse(edit.config);
      const base = { name: edit.name, groupLabel: edit.groupLabel, description: edit.description, active: edit.active, sortOrder: edit.sortOrder, config };
      if (edit.id) await api('PUT', `/api/admin/tramite-types/${edit.id}`, base);
      else await api('POST', '/api/admin/tramite-types', { ...base, code: edit.code });
      setEdit(null); setOk('Catálogo actualizado'); load();
    } catch (e: any) { setErr(e instanceof SyntaxError ? 'La configuración no es JSON válido' : `${e.message}${e.details ? ': ' + JSON.stringify(e.details) : ''}`); }
  };

  if (!types) return err ? <Alert kind="error">{err}</Alert> : <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catálogo de trámites</h1>
        <Button onClick={() => setEdit({ id: null, code: '', name: '', groupLabel: 'Pregrado', description: '', active: true, sortOrder: 0, config: JSON.stringify({ requiredDocs: [{ slot: 'BOLETA', label: 'Boleta de pago (PDF)', kinds: ['pdf'] }, { slot: 'DNI', label: 'Documento de identidad (PDF, JPG o PNG)', kinds: ['pdf', 'jpg', 'png'] }], fields: [], requiresDeclaration: false, finalizeRequires: ['issued_document'], pendingRules: [] }, null, 2) })}>Nuevo tipo</Button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}{ok && <Alert kind="ok">{ok}</Alert>}
      <Card className="!p-0">
        <ul className="divide-y divide-slate-100 text-sm">
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <div className="font-medium">{t.name} <span className="font-mono text-xs text-slate-500">{t.code} · v{t.version}</span> {!t.active && <span className="rounded bg-slate-200 px-1.5 text-xs">inactivo</span>}</div>
                <div className="text-xs text-slate-500">{t.groupLabel}{t.config.pendingRules?.length ? ` · ⚠ ${t.config.pendingRules.length} regla(s) pendiente(s) de confirmar` : ''}</div>
                {t.config.pendingRules?.map((r: string) => <div key={r} className="text-xs text-amber-800">• {r}</div>)}
              </div>
              <Button variant="secondary" onClick={() => setEdit({ id: t.id, code: t.code, name: t.name, groupLabel: t.groupLabel, description: t.description, active: t.active, sortOrder: t.sortOrder, config: JSON.stringify(t.config, null, 2) })}>Editar</Button>
            </li>
          ))}
        </ul>
      </Card>
      {edit && (
        <Card>
          <h2 className="mb-3 text-base font-semibold">{edit.id ? `Editar ${edit.code}` : 'Nuevo tipo de trámite'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {!edit.id && <input className={inputCls} placeholder="CÓDIGO_EN_MAYÚSCULAS" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />}
            <input className={inputCls} placeholder="Nombre" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input className={inputCls} placeholder="Grupo (Pregrado, Posgrado…)" value={edit.groupLabel} onChange={(e) => setEdit({ ...edit, groupLabel: e.target.value })} />
            <input className={inputCls} placeholder="Descripción" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <input className={inputCls} type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} aria-label="Orden" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Activo</label>
          </div>
          <label className="mt-3 block text-xs font-medium text-slate-600">Configuración (documentos, campos, declaración, condiciones de finalización)</label>
          <textarea className={`${inputCls} mt-1 font-mono text-xs`} rows={14} value={edit.config} onChange={(e) => setEdit({ ...edit, config: e.target.value })} />
          <div className="mt-3 flex gap-2"><Button onClick={save}>Guardar</Button><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button></div>
        </Card>
      )}
    </div>
  );
}
