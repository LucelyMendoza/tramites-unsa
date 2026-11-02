import type { Config } from '../config.js';
import { normalizeName } from './validators.js';

export interface DirectoryResult {
  source: 'fixture' | 'none';
  status: 'match' | 'mismatch' | 'not_found' | 'disabled';
  mismatches: string[];
  checkedAt: string;
}

/**
 * Contraste con una fuente institucional AUTORIZADA (p. ej. SISACAD). No existe aún una integración real:
 * - 'none': desactivado.
 * - 'fixture': registros FICTICIOS para pruebas.
 * El resultado es informativo para el revisor; nunca bloquea el envío.
 * Para producción implementar DirectoryProvider contra la fuente oficial (ver docs/REGLAS_PENDIENTES.md).
 */
export interface DirectoryProvider {
  check(input: { dni: string; cui: string; fullName: string }): Promise<DirectoryResult>;
}

const FIXTURE = [
  { cui: '20201001', dni: '70000001', name: 'QUISPE MAMANI JUAN CARLOS' },
  { cui: '20201002', dni: '70000002', name: 'HUAMAN CCAHUANA MARIA ELENA' },
  { cui: '20151003', dni: '70000003', name: 'FLORES CONDORI PEDRO LUIS' },
];

const fold = (s: string) =>
  normalizeName(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

export function createDirectory(cfg: Pick<Config, 'ACADEMIC_DIRECTORY'>): DirectoryProvider {
  return {
    async check({ dni, cui, fullName }) {
      const checkedAt = new Date().toISOString();
      if (cfg.ACADEMIC_DIRECTORY === 'none') return { source: 'none', status: 'disabled', mismatches: [], checkedAt };
      const rec = FIXTURE.find((r) => r.cui === cui || r.dni === dni);
      if (!rec) return { source: 'fixture', status: 'not_found', mismatches: [], checkedAt };
      const mismatches: string[] = [];
      if (rec.cui !== cui) mismatches.push('cui');
      if (rec.dni !== dni) mismatches.push('dni');
      if (fold(rec.name) !== fold(fullName)) mismatches.push('apellidos_nombres');
      return { source: 'fixture', status: mismatches.length ? 'mismatch' : 'match', mismatches, checkedAt };
    },
  };
}
