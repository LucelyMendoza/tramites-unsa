import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Disposition, SignedUpload, Storage } from './types.js';

/**
 * Driver de disco local. SOLO DESARROLLO/PRUEBAS: no es R2, no ofrece cifrado en reposo ni respaldo.
 * Emite tokens HMAC de corta duración con la misma semántica que una URL prefirmada.
 * config.ts rechaza STORAGE_DRIVER=local con NODE_ENV=production.
 */
export class LocalStorage implements Storage {
  readonly driver: 'local' | 'disk';
  private root: string;

  constructor(
    dir: string,
    private publicApiUrl: string,
    private secret: string,
    driver: 'local' | 'disk' = 'local',
  ) {
    this.driver = driver;
    this.root = resolve(dir);
  }

  private pathFor(key: string) {
    const p = resolve(this.root, key);
    const rel = relative(this.root, p);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Clave inválida');
    return p;
  }

  token(op: 'put' | 'get', key: string, exp: number, extra = ''): string {
    const body = `${op}|${key}|${exp}|${extra}`;
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return Buffer.from(body).toString('base64url') + '.' + sig;
  }

  verifyToken(token: string, op: 'put' | 'get'): { key: string; extra: string } | null {
    const [b, sig] = token.split('.');
    if (!b || !sig) return null;
    const body = Buffer.from(b, 'base64url').toString();
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const e = Buffer.from(expected);
    if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
    const [o, key, exp, extra] = body.split('|');
    if (o !== op || Number(exp) < Date.now()) return null;
    return { key, extra: extra ?? '' };
  }

  async signUpload(key: string, contentType: string, sizeBytes: number, ttl: number): Promise<SignedUpload> {
    const exp = Date.now() + ttl * 1000;
    const t = this.token('put', key, exp, String(sizeBytes));
    return {
      url: `${this.publicApiUrl}/api/_local-storage/${t}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async signDownload(key: string, filename: string, contentType: string, ttl: number, disposition: Disposition = 'attachment'): Promise<string> {
    const exp = Date.now() + ttl * 1000;
    const t = this.token('get', key, exp, Buffer.from(JSON.stringify({ filename, contentType, disposition })).toString('base64url'));
    return `${this.publicApiUrl}/api/_local-storage/${t}`;
  }

  async head(key: string) {
    try {
      const s = await stat(this.pathFor(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async read(key: string, maxBytes: number) {
    const s = await stat(this.pathFor(key));
    if (s.size > maxBytes) throw new Error('Objeto excede el tamaño permitido');
    return readFile(this.pathFor(key));
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  async put(key: string, data: Buffer) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
}
