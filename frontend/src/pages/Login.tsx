import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, BrandMark, Spinner } from '../ui';

interface Acc { email: string; name: string; kind: string }

const ROLE_TONE: Record<string, string> = {
  Estudiante: 'bg-sky-50 text-sky-800 ring-sky-200',
  Egresado: 'bg-violet-50 text-violet-800 ring-violet-200',
  Administrador: 'bg-brand-50 text-brand-800 ring-brand-200',
};
const tone = (kind: string) => ROLE_TONE[Object.keys(ROLE_TONE).find((k) => kind.startsWith(k)) ?? ''] ?? 'bg-slate-50 text-slate-700 ring-slate-200';
const roleOf = (kind: string) => kind.replace(' (prueba)', '').replace('Administrador: ', '');
const initials = (n: string) => n.split(' ').filter((w) => w.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function GoogleGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );
}

export default function Login() {
  const { config, error, googleReady, loginDev, loginGoogle } = useAuth();
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (config?.testAccounts) api<Acc[]>('GET', '/api/dev/accounts').then(setAccounts).catch((e) => setErr(e.message));
  }, [config]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e: any) {
      const m = String(e?.code ?? '');
      setErr(m.includes('popup-closed') ? 'Se cerró la ventana de Google antes de completar el inicio de sesión.' : e.message ?? 'No se pudo iniciar sesión');
    } finally { setBusy(null); }
  };

  if (!config && !error) return <Spinner />;
  const domains = (config?.allowedDomains ?? []).map((d) => `@${d}`).join(', ');

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Panel institucional */}
      <aside className="relative hidden overflow-hidden bg-brand-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-700/40" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-24 h-[30rem] w-[30rem] rounded-full bg-brand-800/60" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="h-11 w-11 text-base" inverted />
          <div>
            <div className="text-sm font-semibold tracking-wide">Universidad Nacional de San Agustín de Arequipa</div>
            <div className="text-xs text-brand-100/80">Dirección de Servicios Académicos</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Trámites académicos en línea</h1>
          <p className="mt-4 text-base text-brand-100/90">
            Solicite certificados, constancias y boletas de notas, adjunte sus documentos y siga cada etapa hasta la emisión.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-50/90">
            {['Seguimiento del estado en tiempo real', 'Subsanación sobre el mismo expediente', 'Documentos privados con enlaces temporales'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/15 text-[11px]">✓</span>{t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-100/60">© {new Date().getFullYear()} UNSA · Sistema de Gestión de Trámites</p>
      </aside>

      {/* Acceso */}
      <main className="flex items-center justify-center bg-slate-50 px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-10 w-10" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Trámites UNSA</div>
              <div className="text-xs text-slate-500">Dirección de Servicios Académicos</div>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-slate-600">Use su cuenta institucional {domains && <span className="font-medium text-slate-800">{domains}</span>}.</p>

          {(error || err) && <div className="mt-5"><Alert kind="error">{error || err}</Alert></div>}

          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => run('google', loginGoogle)}
              disabled={!googleReady || !!busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <GoogleGlyph />
              {busy === 'google' ? 'Conectando con Google…' : 'Continuar con Google'}
            </button>
            {!googleReady && (
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                El acceso con Google se habilita al configurar Firebase
                {config?.googleEnabled ? ' en el frontend (variables VITE_FIREBASE_*).' : ' en el backend (AUTH_MODE=hybrid y FIREBASE_PROJECT_ID).'}
              </p>
            )}
            {googleReady && <p className="mt-3 text-center text-xs text-slate-500">Solo se aceptan correos institucionales verificados.</p>}
          </div>

          {config?.testAccounts && (
            <section className="mt-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Cuentas de prueba</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <ul className="divide-y divide-slate-100">
                  {accounts.map((a) => (
                    <li key={a.email}>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => run(a.email, () => loginDev(a.email))}
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{initials(a.name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{a.name}</span>
                          <span className="block truncate text-xs text-slate-500">{a.email}</span>
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${tone(a.kind)}`}>{roleOf(a.kind)}</span>
                        <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700">{busy === a.email ? '…' : '→'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-xs text-slate-500">Entorno de pruebas: cuentas y datos ficticios. No ingrese documentos ni datos personales reales.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
