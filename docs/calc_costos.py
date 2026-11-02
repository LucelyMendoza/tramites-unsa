#!/usr/bin/env python3
"""Calculadora de almacenamiento y costos. Todos los supuestos son parámetros editables.
Precios (USD) verificados el 14-oct-2026 en las páginas oficiales citadas en COSTOS.md.
Uso: python3 calc_costos.py            (imprime tablas en Markdown)"""
FX = 3.437            # S/ por USD — SUNAT, venta, 7-oct-2026 (vía tucambista.pe)
R2_GB_MONTH = 0.015   # Cloudflare R2 Standard
R2_FREE_GB = 10
R2_CLASS_A = 4.50 / 1e6
R2_CLASS_B = 0.36 / 1e6
R2_FREE_A, R2_FREE_B = 1e6, 10e6

REQ_MONTH = 3000
FILES_BASE = 2            # boleta + DNI
RESUBMIT_RATE = 0.20      # % de solicitudes que pasan por subsanación
FILES_PER_RESUBMIT = 1.3  # archivos nuevos por subsanación (se conservan versiones)
ISSUED_MB = 0.3           # PDF emitido por el área

def files_per_req(): return FILES_BASE + RESUBMIT_RATE * FILES_PER_RESUBMIT + 1  # +1 documento emitido

def storage_gb(avg_mb, months):
    mb_per_req = (FILES_BASE + RESUBMIT_RATE * FILES_PER_RESUBMIT) * avg_mb + ISSUED_MB
    return REQ_MONTH * mb_per_req * months / 1024, mb_per_req

def r2_cost(gb):  # costo mensual en estado estable
    return max(0.0, gb - R2_FREE_GB) * R2_GB_MONTH

def ops_cost():
    a = REQ_MONTH * (files_per_req() + 3)      # PUT de archivos + metadatos/limpieza
    b = REQ_MONTH * 25                         # HEAD/GET (validación, descargas del admin y del solicitante)
    return a, b, max(0, a - R2_FREE_A) * R2_CLASS_A + max(0, b - R2_FREE_B) * R2_CLASS_B

if __name__ == '__main__':
    print(f'Supuestos: {REQ_MONTH} solicitudes/mes · {FILES_BASE} adjuntos + {RESUBMIT_RATE:.0%} con subsanación (+{FILES_PER_RESUBMIT} archivos) + PDF emitido {ISSUED_MB} MB · FX S/{FX}\n')
    print('| Tamaño medio por adjunto | MB/solicitud | Retención | Almacenamiento estable | R2 USD/mes | + copia de respaldo USD/mes | Total USD/mes | Total S/ /mes |')
    print('|---|---|---|---|---|---|---|---|')
    for avg in (0.3, 1.0, 2.5):
        for months in (12, 24, 60):
            gb, mbr = storage_gb(avg, months)
            c = r2_cost(gb); cb = r2_cost(gb * 2) - c
            print(f'| {avg} MB | {mbr:.2f} | {months} meses | {gb:,.1f} GB | {c:.2f} | {cb:.2f} | {c+cb:.2f} | {(c+cb)*FX:.2f} |')
    a, b, oc = ops_cost()
    print(f'\nOperaciones R2/mes: Clase A ≈ {a:,.0f} (gratis hasta 1 M), Clase B ≈ {b:,.0f} (gratis hasta 10 M) → costo operaciones ≈ USD {oc:.2f}')
    # Base de datos
    kb_req = 12
    gb_yr = REQ_MONTH * 12 * kb_req / 1024 / 1024
    print(f'\nPostgreSQL: ≈{kb_req} KB por solicitud (fila, versiones, historial, auditoría, outbox) → {gb_yr:.2f} GB/año; 5 años ≈ {gb_yr*5:.1f} GB')
    # Correos
    for per in (4, 6):
        print(f'Correos/mes con {per} correos por solicitud ≈ {REQ_MONTH*per:,}  (Resend Free: 3,000/mes y 100/día; Pro USD 20: 50,000/mes)')
