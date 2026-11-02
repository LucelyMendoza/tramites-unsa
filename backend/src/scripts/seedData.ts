import { syncAcademicUnits } from './academicUnits.js';
import type { Db } from '../db/index.js';

/**
 * Catálogos base: facultades/escuelas oficiales de la UNSA y tipos de trámite de la DSA.
 * Devuelve true si la base estaba vacía (primera carga).
 */
export async function seedCatalogs(db: Db) {
  const n = (await db.query<any>(`SELECT count(*)::int AS n FROM faculties`))[0].n;
  await syncAcademicUnits(db);
  await syncTramiteTypes(db);
  return n === 0;
}

/* ------------------------------------------------------------------------------------------------
 * Catálogo de trámites de la DSA (opciones vigentes del portal de Gestión de Certificaciones).
 * Los documentos mínimos (boleta + documento de identidad) los agrega parseConfig a todos los tipos.
 * ---------------------------------------------------------------------------------------------- */
const ANIOS_ACADEMICOS = ['1°', '2°', '3°', '4°', '5°', '6°', '7°'];
const NUMERO_BOLETA = { key: 'numeroBoleta', type: 'receipt', label: 'Número de boleta de pago', required: true, unique: true };
const DJ_POSGRADO = { requiresDeclaration: true, declarationVersion: 'v1' };
const G = { PRE: 'Pregrado', POS: 'Posgrado (maestrías y doctorados)', SEG: 'Segundas especialidades y programas especiales', OTR: 'Otros trámites' };

export const TRAMITE_CATALOG: { code: string; name: string; group: string; config: object }[] = [
  { code: 'LIBRETA_NOTAS', name: 'Libreta de notas', group: G.PRE, config: { fields: [NUMERO_BOLETA] } },
  { code: 'CONST_PRIMERA_MAT_PRE', name: 'Constancia de primera matrícula pregrado', group: G.PRE, config: {} },
  { code: 'CONST_EGRESADO_PRE', name: 'Constancia de egresado pregrado', group: G.PRE, config: {} },
  { code: 'CONST_PRIMERA_MAT_POS', name: 'Constancia de primera matrícula posgrado (maestrías y doctorados)', group: G.POS, config: { ...DJ_POSGRADO } },
  { code: 'CERT_ESTUDIOS_PRE', name: 'Certificado de estudios pregrado (año 2026)', group: G.PRE, config: { fields: [{ key: 'aniosAcademicos', type: 'multi-select', label: 'Años académicos', required: true, options: ANIOS_ACADEMICOS, maxSelect: ANIOS_ACADEMICOS.length }] } },
  { code: 'CERT_ESTUDIOS_POS', name: 'Certificado de estudios posgrado (maestrías y doctorados)', group: G.POS, config: { ...DJ_POSGRADO } },
  { code: 'CONST_EGRESADO_SEGESP', name: 'Constancia de egresado – segundas especialidades y programas especiales', group: G.SEG, config: { ...DJ_POSGRADO } },
  { code: 'CONDICION_EGRESO_BACH', name: 'Condición de egreso para el trámite de bachiller (virtual)', group: G.PRE, config: {} },
  { code: 'CONST_EGRESADO_POS', name: 'Constancia de egresado posgrado (maestrías y doctorados)', group: G.POS, config: { ...DJ_POSGRADO } },
  { code: 'CONST_NO_ADEUDO_BIB', name: 'Constancia de no adeudar material bibliográfico', group: G.OTR, config: {} },
  { code: 'DEUDA_MATRICULA_2020_2021', name: 'Deuda de matrícula 2020 – 2021', group: G.OTR, config: {} },
  { code: 'ACTUALIZACION_FOTO', name: 'Actualización de foto en el sistema', group: G.OTR, config: {} },
  { code: 'MULTA_NO_VOTAR', name: 'Multa por no votar', group: G.OTR, config: {} },
  { code: 'CONST_RANKING_2025', name: 'Constancia de ranking (periodo 2025)', group: G.PRE, config: {} },
];
/** Tipos del prototipo anterior: se desactivan (no se borran: pueden tener solicitudes asociadas). */
const LEGACY_CODES = ['CERTIFICADO', 'CONSTANCIAS', 'RANKING', 'BOLETA_NOTAS', 'SEGUNDA_ESPECIALIDAD', 'POSGRADO'];

/** Inserta los tipos del catálogo que falten y desactiva los heredados. No pisa ediciones hechas desde el panel. */
export async function syncTramiteTypes(db: Db) {
  let added = 0;
  for (const [i, t] of TRAMITE_CATALOG.entries()) {
    const r = await db.query<any>(
      `INSERT INTO tramite_types(code,name,group_label,sort_order,config) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (code) DO NOTHING RETURNING id`,
      [t.code, t.name, t.group, i + 1, JSON.stringify({ finalizeRequires: ['issued_document'], ...t.config })],
    );
    added += r.length;
  }
  await db.query(`UPDATE tramite_types SET active=false WHERE code = ANY($1::text[]) AND active`, [LEGACY_CODES]);
  return added;
}

/** Cuentas de PRUEBA (dev): roles asignados desde el backend. */
export async function seedDevStaff(db: Db, domain: string) {
  const staff: [string, string, string, string | null][] = [
    [`revisor@${domain}`, 'Revisor de Prueba', 'reviewer', null],
    [`revisor.posgrado@${domain}`, 'Revisora de Posgrado (Prueba)', 'reviewer', null],
    [`emisor@${domain}`, 'Emisor de Prueba', 'issuer', null],
    [`admin@${domain}`, 'Superadmin de Prueba', 'superadmin', null],
  ];
  for (const [email, name, role] of staff) {
    const u = (await db.query<any>(`INSERT INTO users(email,display_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`, [email, name]))[0];
    await db.query(
      `INSERT INTO staff_roles(user_id,role,granted_by) VALUES ($1,$2,'seed-dev') ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role, active=true`,
      [u.id, role],
    );
  }
}

export async function bootstrapSuperadmins(db: Db, emails: string, allowedDomains: string[]) {
  for (const raw of emails.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const domain = raw.split('@')[1];
    if (!allowedDomains.includes(domain)) throw new Error(`BOOTSTRAP_SUPERADMINS: ${raw} no pertenece a un dominio permitido`);
    const u = (await db.query<any>(`INSERT INTO users(email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [raw]))[0];
    await db.query(
      `INSERT INTO staff_roles(user_id,role,granted_by) VALUES ($1,'superadmin','bootstrap') ON CONFLICT (user_id) DO NOTHING`,
      [u.id],
    );
  }
}

/**
 * Reglas de responsables de PRUEBA (solo si aún no hay ninguna): posgrado y segundas especialidades →
 * revisora de posgrado; pregrado y otros trámites → revisor general. En producción las define el superadmin.
 */
export async function seedDevAssignmentRules(db: Db, domain: string) {
  if ((await db.query<any>(`SELECT count(*)::int AS n FROM assignment_rules`))[0].n > 0) return false;
  const id = async (email: string) => (await db.query<any>(`SELECT id FROM users WHERE email=$1`, [email]))[0]?.id;
  const general = await id(`revisor@${domain}`);
  const posgrado = await id(`revisor.posgrado@${domain}`);
  if (!general || !posgrado) return false;
  const types = await db.query<any>(`SELECT id,group_label FROM tramite_types WHERE active`);
  for (const t of types) {
    const who = /posgrado|segundas/i.test(t.group_label) ? posgrado : general;
    await db.query(`INSERT INTO assignment_rules(tramite_type_id,assignee_id,updated_by) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING`, [t.id, who]);
  }
  return true;
}
