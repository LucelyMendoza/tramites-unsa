import { createHash } from 'node:crypto';

export type Kind = 'pdf' | 'jpg' | 'png';

export const MIME_BY_KIND: Record<Kind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
};

export function kindFromName(name: string): Kind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'png') return 'png';
  return null;
}

export function kindFromMime(mime: string): Kind | null {
  const m = mime.toLowerCase().split(';')[0].trim();
  return (Object.entries(MIME_BY_KIND).find(([, v]) => v === m)?.[0] as Kind | undefined) ?? null;
}

/** Detecta el tipo real por firma ("magic bytes"), ignorando extensión y Content-Type declarado. */
export function sniff(buf: Buffer): Kind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

/**
 * Comprobaciones de contenido PDF activo: JavaScript, acciones de lanzamiento y archivos incrustados.
 * Se buscan NOMBRES PDF completos (seguidos de un delimitador), no subcadenas: así `/AAPL:Keywords`
 * (metadatos de Vista Previa de macOS) o `/JSON…` no se confunden con `/AA` o `/JS`.
 * `/OpenAction` y `/AA` no se rechazan por sí solos: casi todo PDF exportado de Word/Acrobat usa
 * `/OpenAction` para fijar página y zoom inicial; si la acción ejecuta código, aparece `/JavaScript`,
 * `/JS` o `/Launch` y se rechaza igual.
 */
const PDF_RISKY = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia'];
export function pdfRiskyMarkers(buf: Buffer): string[] {
  const text = buf.toString('latin1');
  const found: string[] = [];
  for (const m of PDF_RISKY) {
    // Delimitadores PDF: espacio en blanco y ( ) < > [ ] { } / %
    if (new RegExp(`/${m}(?=[\\s()<>\\[\\]{}/%])`).test(text)) found.push('/' + m);
  }
  return found;
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface Verification {
  ok: boolean;
  reason?: string;
  detected?: Kind;
  sha256?: string;
}

export function verifyContent(buf: Buffer, allowed: Kind[], declaredName: string, declaredMime: string): Verification {
  const detected = sniff(buf);
  if (!detected) return { ok: false, reason: 'El contenido del archivo no es PDF, JPG ni PNG válido' };
  if (!allowed.includes(detected)) return { ok: false, reason: `Tipo ${detected.toUpperCase()} no permitido para este documento` };
  const byName = kindFromName(declaredName);
  const byMime = kindFromMime(declaredMime);
  if (byName !== detected || byMime !== detected)
    return { ok: false, reason: 'La extensión o el tipo declarado no coincide con el contenido real del archivo' };
  if (detected === 'pdf') {
    const risky = pdfRiskyMarkers(buf);
    if (risky.length) return { ok: false, reason: `El PDF contiene elementos activos no permitidos (${risky.join(', ')})` };
  }
  return { ok: true, detected, sha256: sha256(buf) };
}
