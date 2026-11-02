import { useMemo, useState } from 'react';

export interface Series { key: string; name: string; color: string }
export interface Group { label: string; values: Record<string, number> }

/**
 * Barras agrupadas (una barra por serie y periodo). Eje y único desde cero, rejilla tenue,
 * leyenda siempre visible con ≥2 series, tooltip al pasar el cursor y tabla accesible alternativa.
 */
export function BarChart({ groups, series, height = 260, title }: { groups: Group[]; series: Series[]; height?: number; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = Math.max(560, groups.length * (series.length * 22 + 26) + 56);
  const H = height, padL = 40, padB = 32, padT = 12, plotH = H - padB - padT, plotW = W - padL - 8;
  const max = Math.max(1, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0)));
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4 / (max > 20 ? 5 : 1)) * (max > 20 ? 5 : 1));
    return Array.from({ length: Math.floor(max / step) + 2 }, (_, i) => i * step).filter((t) => t <= Math.max(max, step) + step - 1).slice(0, 6);
  }, [max]);
  const top = ticks.at(-1)!;
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const slot = plotW / groups.length;
  const bw = Math.min(22, (slot - 14) / series.length - 2);

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <figcaption className="sr-only">{title}</figcaption>
        {series.length > 1 && series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>
        ))}
        <button onClick={() => setAsTable(!asTable)} className="ml-auto text-xs font-medium text-brand-700 hover:underline">{asTable ? 'Ver gráfico' : 'Ver tabla'}</button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1.5 pr-4">Periodo</th>{series.map((s) => <th key={s.key} className="py-1.5 pr-4 text-right">{s.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{groups.map((g) => <tr key={g.label}><td className="py-1.5 pr-4">{g.label}</td>{series.map((s) => <td key={s.key} className="py-1.5 pr-4 text-right tabular-nums">{g.values[s.key] ?? 0}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{t}</text>
              </g>
            ))}
            {groups.map((g, gi) => {
              const x0 = padL + gi * slot + (slot - series.length * (bw + 2)) / 2;
              return (
                <g key={g.label} onMouseEnter={() => setHover(gi)}>
                  <rect x={padL + gi * slot} y={padT} width={slot} height={plotH} fill={hover === gi ? '#f1f5f9' : 'transparent'} />
                  {series.map((s, si) => {
                    const v = g.values[s.key] ?? 0, h = Math.max(v > 0 ? 2 : 0, (v / top) * plotH);
                    const x = x0 + si * (bw + 2), yy = padT + plotH - h;
                    return <path key={s.key} fill={s.color} d={h < 4 ? `M${x},${yy}h${bw}v${h}h${-bw}z` : `M${x},${yy + 4}a4,4 0 0 1 4,-4h${bw - 8}a4,4 0 0 1 4,4v${h - 4}h${-bw}z`} />;
                  })}
                  <text x={padL + gi * slot + slot / 2} y={H - 12} textAnchor="middle" fontSize="11" fill={hover === gi ? '#0f172a' : '#64748b'}>{g.label}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-2 rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
              style={{ left: `clamp(0px, calc(${((padL + hover * slot + slot / 2) / W) * 100}% - 70px), calc(100% - 150px))` }}>
              <div className="mb-1 font-semibold text-slate-900">{groups[hover].label}</div>
              {series.map((s) => <div key={s.key} className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}<span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">{groups[hover].values[s.key] ?? 0}</span></div>)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
