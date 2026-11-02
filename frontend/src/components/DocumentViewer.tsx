import { useEffect, useState } from 'react';
import { getSignedFile, triggerDownload, type SignedFile } from '../api';
import { Button } from '../ui';
import { PdfPages } from './PdfPages';

/**
 * Visor de documentos: muestra PDF/imagen dentro de la página (URL firmada con disposición `inline`).
 * La descarga es una acción aparte y explícita (URL firmada con `attachment`); ambas quedan auditadas.
 */
export function DocumentViewer({ path, title, onClose }: { path: string; title: string; onClose(): void }) {
  const [file, setFile] = useState<SignedFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    getSignedFile(path, 'inline').then((f) => alive && setFile(f)).catch((e) => alive && setErr(e.message ?? 'No se pudo abrir el documento'));
    return () => { alive = false; };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const download = async () => {
    setDownloading(true);
    try { triggerDownload(await getSignedFile(path, 'attachment')); }
    catch (e: any) { setErr(e.message ?? 'No se pudo descargar'); }
    finally { setDownloading(false); }
  };

  const isPdf = file?.contentType === 'application/pdf';
  const isImage = file?.contentType?.startsWith('image/');

  return (
    <div role="dialog" aria-modal="true" aria-label={`Vista previa: ${title}`} className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/70 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-5 sm:py-3" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
            <div className="truncate text-xs text-slate-500">{file?.filename ?? 'Cargando…'}</div>
          </div>
          <Button variant="secondary" onClick={download} disabled={!file || downloading} aria-label="Descargar" className="!px-2.5 sm:!px-3.5">
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
            <span className="hidden sm:inline">{downloading ? 'Descargando…' : 'Descargar'}</span>
          </Button>
          <button onClick={onClose} aria-label="Cerrar vista previa" className="grid h-10 w-10 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100">✕</button>
        </header>
        <div className="relative min-h-0 flex-1 bg-slate-100 sm:h-[75vh] sm:flex-none">
          {err && <div className="p-6 text-sm text-red-700">{err}</div>}
          {!err && !file && (
            <div className="flex h-full items-center justify-center gap-3 p-10 text-sm text-slate-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />Abriendo documento…
            </div>
          )}
          {file && isPdf && <div className="absolute inset-0"><PdfPages url={file.url} title={title} /></div>}
          {file && isImage && (
            <div className="absolute inset-0 flex items-center justify-center overflow-auto p-3 sm:p-4">
              <img src={file.url} alt={title} className="max-h-full max-w-full rounded-lg bg-white object-contain shadow" />
            </div>
          )}
          {file && !isPdf && !isImage && <div className="p-6 text-sm text-slate-600">Este tipo de archivo no tiene vista previa. Use «Descargar».</div>}
        </div>
        <footer className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 sm:px-5" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          Enlace temporal y privado. La vista previa y la descarga quedan registradas en la auditoría.
        </footer>
      </div>
    </div>
  );
}
