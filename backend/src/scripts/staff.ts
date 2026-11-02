/**
 * Gestión de roles administrativos. ÚNICO mecanismo (junto con BOOTSTRAP_SUPERADMINS) para otorgar roles:
 * se ejecuta en el servidor/consola del backend, nunca desde el navegador.
 *
 *   npm run staff:grant -- correo@dominio reviewer [facultyId1,facultyId2]
 *   npm run staff:revoke -- correo@dominio
 *   npm run staff:list
 */
import { allowedDomains, loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';
import { audit } from '../modules/service.js';

const [cmd, email, role, scope] = process.argv.slice(2);
const cfg = loadConfig();
const db = await createDb(cfg);
await migrate(db);
try {
  if (cmd === 'grant') {
    if (!email || !['superadmin', 'reviewer', 'issuer'].includes(role)) throw new Error('Uso: staff:grant -- <correo> <superadmin|reviewer|issuer> [facultyIds separados por coma]');
    const domain = email.split('@')[1]?.toLowerCase();
    if (!allowedDomains(cfg).includes(domain)) throw new Error('El correo no pertenece a un dominio permitido');
    const scopeArr = scope ? scope.split(',').map((s) => s.trim()) : null;
    const u = (await db.query<any>(`INSERT INTO users(email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [email.toLowerCase()]))[0];
    await db.query(
      `INSERT INTO staff_roles(user_id,role,faculty_scope,granted_by) VALUES ($1,$2,$3::jsonb,'cli')
       ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role, faculty_scope=EXCLUDED.faculty_scope, active=true, granted_at=now()`,
      [u.id, role, scopeArr ? JSON.stringify(scopeArr) : null],
    );
    await audit(db, { email: 'cli' }, 'staff.grant', 'user', u.id, { email, role, scope: scopeArr });
    console.log(`Rol ${role} otorgado a ${email}${scopeArr ? ` (facultades: ${scopeArr.join(', ')})` : ' (todas las facultades)'}`);
  } else if (cmd === 'revoke') {
    const r = await db.query<any>(`UPDATE staff_roles SET active=false WHERE user_id=(SELECT id FROM users WHERE email=$1) RETURNING user_id`, [email?.toLowerCase()]);
    if (!r[0]) throw new Error('No se encontró personal con ese correo');
    await audit(db, { email: 'cli' }, 'staff.revoke', 'user', r[0].user_id, { email });
    console.log(`Rol revocado para ${email}`);
  } else if (cmd === 'list') {
    console.table(await db.query(`SELECT u.email,s.role,s.faculty_scope,s.active,s.granted_by FROM staff_roles s JOIN users u ON u.id=s.user_id ORDER BY u.email`));
  } else {
    throw new Error('Comandos: grant | revoke | list');
  }
} finally {
  await db.close();
}
