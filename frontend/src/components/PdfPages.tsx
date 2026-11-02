import { useEffect, useRef, useState } from 'react';

/**
 * Renderiza un PDF página por página en <canvas> con PDF.js (servido desde /pdfjs, sin CDN).
 * Funciona igual en escritorio, Android e iOS (los visores nativos en <iframe> fallan en móviles)
 * y no expone la barra del visor del navegador: la descarga es una acción aparte y auditada.
 * Seguridad: PDF.js no ejecuta JavaScript del documento (sin scripting) y se desactiva eval.
 */
type PdfJs = any;
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import(/* @vite-ignore */ `${location.origin}/pdfjs/pdf.min.mjs`).then((m: PdfJs) => {
    m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    return m;
  });
  return pdfjsPromise;
}

const MAX_PAGES = 60;

export function PdfPages({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true, task: any;
    (async () => {
      try {
        const [pdfjs, res] = await Promise.all([loadPdfJs(), fetch(url, { credentials: 'omit' })]);
        if (!res.ok) throw new Error(`No se pudo obtener el documento (HTTP ${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        task = pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: '/pdfjs/standard_fonts/' });
        const d = await task.promise;
        if (alive) setDoc(d); else d.destroy();
      } catch (e: any) {
        if (alive) setErr(e?.name === 'PasswordException' ? 'El PDF está protegido con contraseña.' : e?.message ?? 'No se pudo mostrar el PDF');
      }
    })();
    return () => { alive = false; task?.destroy?.(); };
  }, [url]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = doc ? Math.min(doc.numPages, MAX_PAGES) : 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-3 py-1.5 text-xs text-slate-600">
        <span className="tabular-nums">{doc ? `${doc.numPages} página${doc.numPages === 1 ? '' : 's'}` : err ? '' : 'Cargando…'}</span>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button className="h-8 w-8 rounded-md ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Alejar">−</button>
          <button className="h-8 min-w-14 rounded-md px-2 tabular-nums ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => setZoom(1)} aria-label="Ajustar al ancho">{Math.round(zoom * 100)} %</button>
          <button className="h-8 w-8 rounded-md ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Acercar">+</button>
        </div>
      </div>
      <div ref={box} className="flex-1 overflow-auto bg-slate-200/70 px-2 py-3 sm:px-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {err && <p className="mx-auto max-w-md rounded-lg bg-white p-4 text-sm text-red-700 shadow">{err}</p>}
        {!doc && !err && (
          <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />Abriendo documento…
          </div>
        )}
        {doc && doc.numPages === 0 && <p className="mx-auto max-w-md rounded-lg bg-white p-4 text-sm text-slate-700 shadow">Este PDF no tiene páginas (archivo vacío o dañado). Pida al responsable que cargue nuevamente el documento.</p>}
        {doc && width > 0 && Array.from({ length: pages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={(width - 8) * zoom} label={`${title}, página ${i + 1}`} />)}
        {doc && doc.numPages > MAX_PAGES && <p className="p-4 text-center text-xs text-slate-600">Se muestran las primeras {MAX_PAGES} páginas. Descargue el documento para verlo completo.</p>}
      </div>
    </div>
  );
}

function PdfPage({ doc, n, width, label }: { doc: any; n: number; width: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  useEffect(() => {
    let task: any, alive = true;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (!alive) return;
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current!;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvasContext: c.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => { alive = false; task?.cancel?.(); };
  }, [doc, n, width]);
  return (
    <canvas ref={canvas} role="img" aria-label={label} className="mx-auto mb-3 block bg-white shadow-md"
      style={{ width: `${width}px`, height: `${width * ratio}px`, maxWidth: 'none' }} />
  );
}
