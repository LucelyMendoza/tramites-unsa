import { createHmac, timingSafeEqual } from 'node:crypto';
import { allowedDomains, type Config } from '../config.js';

export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  hostedDomain?: string;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedIdentity>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

/** Valida dominio institucional en el BACKEND (no solo en el navegador). */
export function assertAllowedIdentity(id: VerifiedIdentity, cfg: Config): void {
  if (!id.email) throw new AuthError('El token no contiene correo');
  if (!id.emailVerified) throw new AuthError('El correo de la cuenta no está verificado', 403);
  const domain = id.email.split('@')[1]?.toLowerCase();
  const allowed = allowedDomains(cfg);
  if (!domain || !allowed.includes(domain))
    throw new AuthError(`Solo se permiten cuentas institucionales (${allowed.map((d) => '@' + d).join(', ')})`, 403);
  if (id.hostedDomain && !allowed.includes(id.hostedDomain.toLowerCase()))
    throw new AuthError('La cuenta no pertenece al dominio institucional autorizado', 403);
}

/** Producción: verifica el ID token de Firebase Authentication con el SDK Admin. */
export class FirebaseVerifier implements TokenVerifier {
  private authPromise: Promise<import('firebase-admin/auth').Auth>;
  private checkRevoked: boolean;
  constructor(cfg: Config) {
    this.checkRevoked = !!(cfg.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
    this.authPromise = (async () => {
      const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      if (!getApps().length) {
        initializeApp({
          projectId: cfg.FIREBASE_PROJECT_ID || undefined,
          // Sin cuenta de servicio basta el projectId para verificar la firma del ID token (sin revocación).
          ...(cfg.FIREBASE_SERVICE_ACCOUNT_JSON
            ? { credential: cert(JSON.parse(cfg.FIREBASE_SERVICE_ACCOUNT_JSON)) }
            : process.env.GOOGLE_APPLICATION_CREDENTIALS
              ? { credential: applicationDefault() }
              : {}),
        });
      }
      return getAuth();
    })();
  }
  async verify(idToken: string): Promise<VerifiedIdentity> {
    const auth = await this.authPromise;
    let d;
    try {
      d = await auth.verifyIdToken(idToken, this.checkRevoked);
    } catch {
      throw new AuthError('Token inválido o expirado');
    }
    if (d.firebase?.sign_in_provider !== 'google.com') throw new AuthError('Solo se permite inicio de sesión con Google', 403);
    return {
      uid: d.uid,
      email: (d.email ?? '').toLowerCase(),
      emailVerified: !!d.email_verified,
      name: (d.name as string) ?? '',
      hostedDomain: (d as any).hd,
    };
  }
}

/** Solo desarrollo/pruebas: token HMAC emitido por /api/dev/login para cuentas de prueba. */
export class DevVerifier implements TokenVerifier {
  constructor(private secret: string) {}
  sign(email: string, name: string, ttlSeconds = 8 * 3600): string {
    const body = Buffer.from(JSON.stringify({ email, name, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `dev.${body}.${sig}`;
  }
  async verify(token: string): Promise<VerifiedIdentity> {
    const [prefix, body, sig] = token.split('.');
    if (prefix !== 'dev' || !body || !sig) throw new AuthError('Token inválido');
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError('Token inválido');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) throw new AuthError('Token expirado');
    return { uid: `dev:${p.email}`, email: p.email, emailVerified: true, name: p.name ?? '' };
  }
}

/** Solo desarrollo/pruebas: acepta tokens de cuentas de prueba (prefijo `dev.`) y ID tokens de Firebase. */
export class HybridVerifier implements TokenVerifier {
  constructor(
    public dev: DevVerifier,
    private google?: FirebaseVerifier,
  ) {}
  async verify(token: string): Promise<VerifiedIdentity> {
    if (token.startsWith('dev.')) return this.dev.verify(token);
    if (!this.google) throw new AuthError('Inicio de sesión con Google no configurado');
    return this.google.verify(token);
  }
}

export function devVerifierOf(v: TokenVerifier): DevVerifier | undefined {
  if (v instanceof DevVerifier) return v;
  if (v instanceof HybridVerifier) return v.dev;
  return undefined;
}
