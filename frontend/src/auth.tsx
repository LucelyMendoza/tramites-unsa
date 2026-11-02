import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setTokenProvider } from './api';
import type { Me, PublicConfig } from './types';

interface Ctx {
  config: PublicConfig | null;
  me: Me | null;
  loading: boolean;
  error: string | null;
  /** Google disponible: el backend lo acepta y el frontend tiene la configuración de Firebase. */
  googleReady: boolean;
  loginDev(email: string): Promise<void>;
  loginGoogle(): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as never);
export const useAuth = () => useContext(AuthCtx);

const fbEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
export const hasFirebaseConfig = !!(fbEnv.apiKey && fbEnv.projectId && fbEnv.authDomain);

let devToken: string | null = null;
try { devToken = sessionStorage.getItem('devToken'); } catch { /* sin storage */ }
const setDevToken = (t: string | null) => {
  devToken = t;
  try { t ? sessionStorage.setItem('devToken', t) : sessionStorage.removeItem('devToken'); } catch { /* sin storage */ }
};

async function firebaseBits() {
  const [{ initializeApp, getApps }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = getApps()[0] ?? initializeApp(fbEnv as Record<string, string>);
  return { auth: auth.getAuth(app), mod: auth };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const googleReady = !!config?.googleEnabled && hasFirebaseConfig;

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>('GET', '/api/me'));
      setError(null);
      return true;
    } catch (e: any) {
      setMe(null);
      if (e.status && e.status !== 401) setError(e.message);
      return false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<PublicConfig>('GET', '/api/public-config');
        setConfig(cfg);
        if (cfg.authMode === 'firebase' && !hasFirebaseConfig)
          throw new Error('El backend exige Google (Firebase) pero faltan las variables VITE_FIREBASE_* del frontend.');
        const useGoogle = cfg.googleEnabled && hasFirebaseConfig;
        let fbAuth: Awaited<ReturnType<typeof firebaseBits>>['auth'] | null = null;
        if (useGoogle) {
          fbAuth = (await firebaseBits()).auth;
          const a = fbAuth;
          await new Promise<void>((resolve) => { const un = a.onAuthStateChanged(() => { un(); resolve(); }); });
        }
        if (!cfg.testAccounts) setDevToken(null);
        // Prioridad: sesión de cuenta de prueba (si existe) y luego Google.
        setTokenProvider(async () => devToken ?? (fbAuth?.currentUser ? fbAuth.currentUser.getIdToken() : null));
        if (devToken || fbAuth?.currentUser) await loadMe();
      } catch (e: any) {
        setError(e.message ?? 'No se pudo conectar con el servidor');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  const value = useMemo<Ctx>(
    () => ({
      config, me, loading, error, googleReady,
      async loginDev(email) {
        const r = await api<{ token: string }>('POST', '/api/dev/login', { email });
        setDevToken(r.token);
        await loadMe();
      },
      async loginGoogle() {
        setError(null);
        setDevToken(null);
        const { auth, mod } = await firebaseBits();
        const provider = new mod.GoogleAuthProvider();
        const hd = import.meta.env.VITE_HOSTED_DOMAIN as string | undefined;
        provider.setCustomParameters({ prompt: 'select_account', ...(hd ? { hd } : {}) });
        await mod.signInWithPopup(auth, provider);
        // El backend valida dominio y correo verificado; si rechaza, se cierra la sesión de Google.
        if (!(await loadMe())) {
          await mod.signOut(auth);
          throw new Error(`Su cuenta no está autorizada. Use su correo institucional (${(config?.allowedDomains ?? []).map((d) => '@' + d).join(', ')}).`);
        }
      },
      async logout() {
        setDevToken(null);
        if (googleReady) { const { auth, mod } = await firebaseBits(); await mod.signOut(auth); }
        setMe(null);
      },
      refresh: async () => { await loadMe(); },
    }),
    [config, me, loading, error, googleReady, loadMe],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
