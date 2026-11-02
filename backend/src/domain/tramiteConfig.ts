import { z } from 'zod';

const fileKind = z.enum(['pdf', 'jpg', 'png']);

export const requiredDocSchema = z.object({
  slot: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  label: z.string().min(2),
  kinds: z.array(fileKind).min(1),
  maxMb: z.number().positive().max(25).optional(),
});

export const fieldSchema = z.discriminatedUnion('type', [
  z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/),
    type: z.literal('multi-year'),
    label: z.string(),
    required: z.boolean().default(true),
    /** Cuántos años hacia atrás (desde el actual) se muestran como opción. */
    yearsBack: z.number().int().min(1).max(40).default(10),
    maxSelect: z.number().int().min(1).max(40).default(10),
  }),
  z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/),
    type: z.literal('text'),
    label: z.string(),
    required: z.boolean().default(false),
    maxLength: z.number().int().min(1).max(500).default(200),
  }),
  z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/),
    type: z.literal('multi-select'),
    label: z.string(),
    required: z.boolean().default(true),
    /** Opciones fijas, p. ej. años académicos 1°…7°. */
    options: z.array(z.string().min(1)).min(1),
    maxSelect: z.number().int().min(1).max(40).default(10),
  }),
  z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/),
    type: z.literal('receipt'),
    label: z.string(),
    required: z.boolean().default(true),
    /** Si es true, el mismo número de boleta no puede usarse en otra solicitud (de ningún tipo). */
    unique: z.boolean().default(true),
  }),
  z.object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/),
    type: z.literal('select'),
    label: z.string(),
    required: z.boolean().default(true),
    options: z.array(z.string().min(1)).min(1),
  }),
]);

export const finalizeConditionSchema = z.enum(['issued_document', 'declaration_verified']);

export const tramiteConfigSchema = z.object({
  requiredDocs: z.array(requiredDocSchema).default([]),
  fields: z.array(fieldSchema).default([]),
  requiresDeclaration: z.boolean().default(false),
  declarationVersion: z.string().default('v1'),
  finalizeRequires: z.array(finalizeConditionSchema).default(['issued_document']),
  /** Notas para el equipo: qué reglas siguen pendientes de confirmar por la universidad. */
  pendingRules: z.array(z.string()).default([]),
});
export type TramiteConfig = z.infer<typeof tramiteConfigSchema>;

export const DEFAULT_DOCS = [
  { slot: 'BOLETA', label: 'Boleta de pago (PDF)', kinds: ['pdf'] as const },
  { slot: 'DNI', label: 'Documento de identidad (PDF, JPG o PNG)', kinds: ['pdf', 'jpg', 'png'] as const },
];

export function parseConfig(raw: unknown): TramiteConfig {
  const cfg = tramiteConfigSchema.parse(raw ?? {});
  // Los adjuntos obligatorios mínimos del sistema (boleta + documento de identidad) siempre existen.
  for (const d of DEFAULT_DOCS) {
    if (!cfg.requiredDocs.some((x) => x.slot === d.slot)) {
      cfg.requiredDocs.unshift({ slot: d.slot, label: d.label, kinds: [...d.kinds] });
    }
  }
  return cfg;
}

const RECEIPT_RE = /^[A-Z0-9][A-Z0-9\- ]{2,28}[A-Z0-9]$/;

/** Clave de unicidad de una boleta: solo letras y dígitos ("B001-000123" = "b001 000123"). */
export const normalizeReceipt = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Boleta única declarada en los datos del trámite (si el tipo la exige). */
export function uniqueReceiptOf(cfg: TramiteConfig, clean: Record<string, unknown>): { key: string; norm: string } | null {
  const f = cfg.fields.find((x) => x.type === 'receipt' && x.unique);
  const v = f && clean[f.key];
  return f && typeof v === 'string' && v ? { key: f.key, norm: normalizeReceipt(v) } : null;
}

export const DECLARATION_TEXT =
  'Declaro que cuento con la autorización de la Unidad de Posgrado correspondiente para realizar este trámite';

export function validateTypeData(
  cfg: TramiteConfig,
  data: Record<string, unknown>,
  now = new Date(),
): { ok: true; clean: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};
  const known = new Set(cfg.fields.map((f) => f.key));
  for (const k of Object.keys(data ?? {})) {
    if (!known.has(k)) errors[k] = 'Campo no permitido para este tipo de trámite';
  }
  const thisYear = now.getFullYear();
  for (const f of cfg.fields) {
    const v = (data ?? {})[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) errors[f.key] = 'Campo obligatorio';
      continue;
    }
    if (f.type === 'multi-year') {
      if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x))) {
        errors[f.key] = 'Debe ser una lista de años';
        continue;
      }
      const years = [...new Set(v as number[])].sort((a, b) => a - b);
      const min = thisYear - f.yearsBack;
      if (years.some((y) => y < min || y > thisYear)) errors[f.key] = `Solo se permiten años entre ${min} y ${thisYear}`;
      else if (years.length > f.maxSelect) errors[f.key] = `Máximo ${f.maxSelect} años`;
      else clean[f.key] = years;
    } else if (f.type === 'text') {
      if (typeof v !== 'string' || v.trim().length > f.maxLength) errors[f.key] = `Texto de hasta ${f.maxLength} caracteres`;
      else clean[f.key] = v.trim();
    } else if (f.type === 'multi-select') {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) errors[f.key] = 'Debe ser una lista de opciones';
      else if (!(v as string[]).every((x) => f.options.includes(x))) errors[f.key] = 'Opción no permitida';
      else {
        const sel = f.options.filter((o) => (v as string[]).includes(o)); // orden del catálogo, sin duplicados
        if (sel.length > f.maxSelect) errors[f.key] = `Máximo ${f.maxSelect} opción(es)`;
        else clean[f.key] = sel;
      }
    } else if (f.type === 'receipt') {
      const s = typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, ' ') : '';
      if (!RECEIPT_RE.test(s)) errors[f.key] = 'Número de boleta inválido: use de 4 a 30 letras, dígitos o guiones';
      else clean[f.key] = s;
    } else if (f.type === 'select') {
      if (typeof v !== 'string' || !f.options.includes(v)) errors[f.key] = 'Opción no permitida';
      else clean[f.key] = v;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, clean };
}
