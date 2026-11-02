import { loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';

const db = await createDb(loadConfig());
const ran = await migrate(db);
console.log(ran.length ? `Aplicadas: ${ran.join(', ')}` : 'Base de datos al día');
await db.close();
