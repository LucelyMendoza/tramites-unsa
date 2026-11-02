import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import { LocalStorage } from './local.js';
import { R2Storage } from './r2.js';
import type { Storage } from './types.js';

export type { Storage } from './types.js';
export { LocalStorage } from './local.js';

export function createStorage(cfg: Config): Storage {
  switch (cfg.STORAGE_DRIVER) {
    case 'r2': return R2Storage.fromR2(cfg);
    case 's3': return R2Storage.fromS3(cfg);
    // Servidor propio: archivos en el disco del servidor, servidos por el API con enlaces firmados de corta vida.
    case 'disk': return new LocalStorage(cfg.DISK_STORAGE_DIR, cfg.PUBLIC_API_URL, cfg.STORAGE_SIGNING_SECRET || cfg.DEV_AUTH_SECRET, 'disk');
    default: return new LocalStorage(cfg.LOCAL_STORAGE_DIR, cfg.PUBLIC_API_URL, cfg.DEV_AUTH_SECRET);
  }
}

/** Clave de objeto aleatoria (192 bits), sin DNI, CUI, nombre ni código de solicitud. */
export function newObjectKey(prefix: 'att' | 'iss'): string {
  return `${prefix}/${randomBytes(24).toString('base64url')}`;
}
