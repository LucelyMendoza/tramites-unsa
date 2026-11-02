import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createStorage } from '../src/storage/index.js';

const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_MODE: 'firebase', MAIL_PROVIDER: 'resend', DEV_TEST_ACCOUNTS_ENABLED: 'false' } as any;

describe('almacenamiento para servidor propio', () => {
  it('disk exige clave de firma larga y URL pública https en producción', () => {
    expect(() => loadConfig({ ...prod, STORAGE_DRIVER: 'disk', PUBLIC_API_URL: 'https://tramites.unsa.edu.pe' })).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(() => loadConfig({ ...prod, STORAGE_DRIVER: 'disk', STORAGE_SIGNING_SECRET: 'x'.repeat(40), PUBLIC_API_URL: 'http://10.0.0.5' })).toThrow(/https/);
    const cfg = loadConfig({ ...prod, STORAGE_DRIVER: 'disk', STORAGE_SIGNING_SECRET: 'x'.repeat(40), PUBLIC_API_URL: 'https://tramites.unsa.edu.pe', DISK_STORAGE_DIR: '/tmp/arch' });
    expect(createStorage(cfg).driver).toBe('disk');
  });
  it('local sigue prohibido en producción', () => {
    expect(() => loadConfig({ ...prod, STORAGE_DRIVER: 'local' })).toThrow(/local/);
  });
  it('s3 genérico firma URLs con estilo de ruta (servidor S3 propio)', async () => {
    const cfg = loadConfig({ ...prod, STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://archivos.unsa.edu.pe', S3_BUCKET: 'tramites', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' });
    const st = createStorage(cfg);
    expect(st.driver).toBe('s3');
    const u = new URL((await st.signUpload('att/abc', 'application/pdf', 100, 300)).url);
    expect(u.host).toBe('archivos.unsa.edu.pe');
    expect(u.pathname).toBe('/tramites/att/abc');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
