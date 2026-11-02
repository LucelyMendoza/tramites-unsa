import type { Db } from '../db/index.js';

/** Facultades y escuelas profesionales de la UNSA (catálogo oficial proporcionado por la DSA). */
export const ACADEMIC_UNITS: { code: string; name: string; schools: [string, string][] }[] = [
  { code: 'AGR', name: 'Agronomía', schools: [['AGR-AGRO', 'Ingeniería Agronómica']] },
  { code: 'CBI', name: 'Ciencias Biológicas', schools: [['CBI-BIO', 'Biología'], ['CBI-NUT', 'Ciencias de la Nutrición'], ['CBI-PES', 'Ingeniería Pesquera']] },
  { code: 'ENF', name: 'Enfermería', schools: [['ENF-ENF', 'Enfermería']] },
  { code: 'MED', name: 'Medicina', schools: [['MED-MED', 'Medicina']] },
  { code: 'ARQ', name: 'Arquitectura y Urbanismo', schools: [['ARQ-ARQ', 'Arquitectura']] },
  { code: 'CNF', name: 'Ciencias Naturales y Formales', schools: [['CNF-FIS', 'Física'], ['CNF-MAT', 'Matemáticas'], ['CNF-QUI', 'Química']] },
  { code: 'GGM', name: 'Ingeniería Geológica, Geofísica y Minas', schools: [['GGM-GEOF', 'Ingeniería Geofísica'], ['GGM-GEOL', 'Ingeniería Geológica'], ['GGM-MIN', 'Ingeniería de Minas']] },
  { code: 'CIV', name: 'Ingeniería Civil', schools: [['CIV-CIV', 'Ingeniería Civil'], ['CIV-SAN', 'Ingeniería Sanitaria']] },
  { code: 'PRO', name: 'Ingeniería de Procesos', schools: [['PRO-MET', 'Ingeniería Metalúrgica'], ['PRO-QUI', 'Ingeniería Química'], ['PRO-AMB', 'Ingeniería Ambiental'], ['PRO-IAL', 'Ingeniería de Industrias Alimentarias'], ['PRO-MAT', 'Ingeniería de Materiales']] },
  { code: 'IPS', name: 'Ingeniería de Producción y Servicios', schools: [['IPS-SIS', 'Ingeniería de Sistemas'], ['IPS-ELE', 'Ingeniería Eléctrica'], ['IPS-MEC', 'Ingeniería Mecánica'], ['IPS-ELN', 'Ingeniería Electrónica'], ['IPS-CCO', 'Ciencia de la Computación'], ['IPS-IND', 'Ingeniería Industrial'], ['IPS-TEL', 'Ingeniería en Telecomunicaciones']] },
  { code: 'EDU', name: 'Ciencias de la Educación', schools: [['EDU-EDU', 'Educación']] },
  { code: 'CHS', name: 'Ciencias Histórico Sociales', schools: [['CHS-HIS', 'Historia'], ['CHS-SOC', 'Sociología'], ['CHS-TSO', 'Trabajo Social'], ['CHS-ANT', 'Antropología'], ['CHS-TUR', 'Turismo y Hotelería']] },
  { code: 'CCF', name: 'Ciencias Contables y Financieras', schools: [['CCF-CON', 'Contabilidad'], ['CCF-FIN', 'Finanzas']] },
  { code: 'DER', name: 'Derecho', schools: [['DER-DER', 'Derecho']] },
  { code: 'ECO', name: 'Economía', schools: [['ECO-ECO', 'Economía']] },
  { code: 'FIH', name: 'Filosofía y Humanidades', schools: [['FIH-ART', 'Artes'], ['FIH-FIL', 'Filosofía'], ['FIH-LIT', 'Literatura y Lingüística']] },
  { code: 'PSI', name: 'Psicología, Relaciones Industriales y Ciencias de la Comunicación', schools: [['PSI-PSI', 'Psicología'], ['PSI-RRII', 'Relaciones Industriales'], ['PSI-COM', 'Ciencias de la Comunicación']] },
  { code: 'ADM', name: 'Administración', schools: [['ADM-ADM', 'Administración'], ['ADM-MKT', 'Marketing'], ['ADM-BYS', 'Banca y Seguros'], ['ADM-GES', 'Gestión']] },
];

/**
 * Sincroniza facultades y escuelas oficiales (idempotente: inserta las que falten y actualiza nombres).
 * Las unidades ficticias del prototipo ("[PRUEBA] …") se desactivan; no se borran porque pueden tener solicitudes.
 */
export async function syncAcademicUnits(db: Db) {
  let added = 0;
  for (const f of ACADEMIC_UNITS) {
    const fr = await db.query<any>(
      `INSERT INTO faculties(code,name,active) VALUES ($1,$2,true)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, active=true RETURNING id, (xmax = 0) AS inserted`,
      [f.code, f.name],
    );
    added += fr[0].inserted ? 1 : 0;
    for (const [code, name] of f.schools) {
      await db.query(
        `INSERT INTO schools(faculty_id,code,name,active) VALUES ($1,$2,$3,true)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, faculty_id=EXCLUDED.faculty_id, active=true`,
        [fr[0].id, code, name],
      );
    }
  }
  await db.query(`UPDATE schools SET active=false WHERE name LIKE '[PRUEBA]%' AND active`);
  await db.query(`UPDATE faculties SET active=false WHERE name LIKE '[PRUEBA]%' AND active`);
  return added;
}
