import type { Config } from '../config.js';

/** DNI peruano: 8 dígitos (formato RENIEC). No se valida dígito verificador: no hay regla institucional provista. */
export function validDni(v: string): boolean {
  return /^\d{8}$/.test(v);
}

/**
 * CUI: la regla institucional NO ha sido confirmada. Se valida con un patrón configurable (CUI_PATTERN)
 * cuyo valor por defecto solo exige dígitos. Ver docs/REGLAS_PENDIENTES.md.
 */
export function validCui(v: string, cfg: Pick<Config, 'CUI_PATTERN'>): boolean {
  try {
    return new RegExp(cfg.CUI_PATTERN).test(v);
  } catch {
    return false;
  }
}

export function normalizeName(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

/** Nombre: al menos dos palabras (apellidos y nombres), solo letras, espacios, guiones, apóstrofes y comas. */
export function validFullName(v: string): boolean {
  const n = normalizeName(v);
  if (n.length < 5 || n.length > 150) return false;
  if (!/^[\p{L}][\p{L}\s'’.,-]*$/u.test(n)) return false;
  return n.split(' ').filter(Boolean).length >= 2;
}

export function maskDni(dni: string): string {
  return dni.length === 8 ? `${dni.slice(0, 2)}****${dni.slice(6)}` : '********';
}
