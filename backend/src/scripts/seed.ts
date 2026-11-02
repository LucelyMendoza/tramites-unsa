import { allowedDomains, loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';
import { seedCatalogs, seedDevStaff } from './seedData.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') throw new Error('seed solo se usa en desarrollo/pruebas (catálogo ficticio)');
const db = await createDb(cfg);
await migrate(db);
console.log((await seedCatalogs(db)) ? 'Catálogo ficticio cargado' : 'El catálogo ya tiene datos');
await seedDevStaff(db, allowedDomains(cfg)[0]);
console.log('Cuentas de prueba de personal creadas');
await db.close();
