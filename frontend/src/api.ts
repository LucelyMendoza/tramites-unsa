const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;
export function setTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await tokenProvider();
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? json?.message ?? `Error ${res.status}`, json?.details);
  return (json ?? text) as T;
}

export async function downloadCsv(path: string, filename: string) {
  const token = await tokenProvider();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'No se pudo exportar');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** presign → PUT directo al almacenamiento → complete (el backend valida el contenido real). */
export async function uploadFile(requestId: string, slot: string, file: File): Promise<void> {
  const p = await api<{ fileId: string; upload: { url: string; method: string; headers: Record<string, string> } }>('POST', `/api/requests/${requestId}/files/presign`, {
    slot, filename: file.name, size: file.size, contentType: file.type,
  });
  await putToStorage(p.upload, file);
  await api('POST', `/api/requests/${requestId}/files/${p.fileId}/complete`, {});
}

export async function putToStorage(upload: { url: string; method: string; headers: Record<string, string> }, file: File) {
  // El almacenamiento local de desarrollo vive en la propia API (misma base); R2 devuelve URL absoluta.
  const url = upload.url.startsWith('http://localhost:4000') && BASE === '' ? upload.url.replace('http://localhost:4000', '') : upload.url;
  const r = await fetch(url, { method: upload.method, headers: upload.headers, body: file });
  if (!r.ok) throw new ApiError(r.status, 'Falló la carga del archivo al almacenamiento');
}

export interface SignedFile { url: string; filename: string; contentType: string; mode: 'inline' | 'attachment' }

/** Pide una URL firmada: `inline` para vista previa, `attachment` para descarga. */
export async function getSignedFile(path: string, mode: 'inline' | 'attachment'): Promise<SignedFile> {
  const r = await api<SignedFile>('GET', `${path}${path.includes('?') ? '&' : '?'}mode=${mode}`);
  const url = r.url.startsWith('http://localhost:4000') && BASE === '' ? r.url.replace('http://localhost:4000', '') : r.url;
  return { ...r, url };
}

/** Descarga explícita: el servidor responde con Content-Disposition: attachment, sin abrir pestañas. */
export function triggerDownload(f: SignedFile) {
  const a = document.createElement('a');
  a.href = f.url;
  a.download = f.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
