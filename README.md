# Sistema de trámites documentarios

Portal web para solicitar certificados, constancias, ranking, boletas de notas, segundas especialidades y posgrado, con panel administrativo independiente. Dimensionado para ≈ 3 000 solicitudes/mes y costo mínimo.

**Estado:** prototipo funcional completo y probado con **cuentas y datos ficticios**. Las integraciones reales (Firebase, R2, Postgres gestionado, Resend) están implementadas pero **no conectadas** a cuentas reales: se activan con variables de entorno (ver `docs/DESPLIEGUE.md`). En producción el backend se niega a arrancar con los modos de prueba.

| Carpeta | Contenido |
|---|---|
| `backend/` | API Fastify + TypeScript, migraciones SQL, 61 pruebas (`npm test`), Dockerfile, `.env.example` |
| `frontend/` | React + TypeScript + Tailwind (portal del solicitante y panel admin), `.env.example` |
| `docs/` | **`GUIA_FIREBASE.md`** (inicio de sesión con Google paso a paso) · **`GUIA_DESPLIEGUE.md`** (nube o servidor propio) · `DISENO.md` · `COSTOS.md` · `ARQUITECTURA.md` · `DESPLIEGUE.md` · `SEGURIDAD_Y_DATOS.md` · `REGLAS_PENDIENTES.md` |
| `deploy/servidor-propio/` | Docker Compose (PostgreSQL + API + nginx), `nginx.conf`, `.env.example`, `respaldo.sh` |
| `render.yaml` | Blueprint de Render (API + purga diaria) |

## Publicar el frontend en Cloudflare Pages con GitHub
Este proyecto tiene dos partes: Pages publica el frontend estático y la API Fastify se despliega aparte (por ejemplo, con el `render.yaml` de este repositorio). Pages no ejecuta directamente el backend.

1. Sube este proyecto a un repositorio nuevo de GitHub. El `.gitignore` excluye los `.env` locales, dependencias, compilaciones y la copia duplicada `tramites-unsa/`; conserva los archivos `.env.example`.
2. En Cloudflare, ve a **Workers & Pages → Create → Pages → Connect to Git**, autoriza GitHub y selecciona el repositorio.
3. Configura la compilación:
   - **Root directory:** `frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION=22`
4. En la configuración de Pages, agrega las variables de compilación `VITE_API_URL` (URL HTTPS de la API desplegada) y, para iniciar sesión con Google, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` y `VITE_HOSTED_DOMAIN`.
5. Despliega la API por separado con Render y configura allí sus secretos y servicios de producción. Añade el dominio de Pages a los dominios autorizados de Firebase y configura `APP_URL` y `CORS_ORIGINS` en la API con la URL de Pages.

No subas archivos `.env` ni secretos de Firebase Admin, base de datos, R2 o correo a GitHub ni a las variables `VITE_*`. Consulta [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) para el checklist de producción.

## Probar en 2 minutos
**Atajo (macOS):** doble clic en `iniciar.command` — instala dependencias si faltan, carga los datos de demostración, levanta API y frontend y abre el navegador. Ctrl+C para detener.

Manual:
```bash
cd backend  && npm install && npm test && npm run demo && npm run dev   # API :4000 (demo carga 14 solicitudes ficticias una sola vez)
cd frontend && npm install && npm run dev                               # http://localhost:5173
```
Con `PGLITE_DIR=.data/pg` (ya en `backend/.env`) los datos persisten entre reinicios. Ejecute `npm run demo` con el API detenido.
Para rehacer los datos de prueba desde cero (solo desarrollo): `npm run demo -- --reset` con el API detenido.

### Acceso
`AUTH_MODE=hybrid` (desarrollo) muestra **ambas** opciones en la pantalla de inicio:

- **Cuentas de prueba**: estudiante, egresado, revisor, emisor y superadmin, sin contraseña.
- **Continuar con Google**: se activa al completar Firebase:
  - `backend/.env`: `FIREBASE_PROJECT_ID` (y opcionalmente `FIREBASE_SERVICE_ACCOUNT_JSON` para verificar revocación).
  - `frontend/.env`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
  - En Firebase: Authentication → Sign-in method → Google habilitado; Settings → Authorized domains incluye `localhost`.
  - Para que una cuenta Google tenga rol administrativo: `npm run staff:grant -- correo@unsa.edu.pe reviewer` (roles: `superadmin`, `reviewer`, `issuer`) (ver `npm run staff:list`).

En producción solo se permite `AUTH_MODE=firebase`: el backend se niega a arrancar con `dev`/`hybrid` o con cuentas de prueba habilitadas.

## Qué cumple y qué queda pendiente
Cumple: roles con alcance por facultad, catálogo configurable, validación de DNI/archivos (contenido real), declaración jurada de Posgrado con evidencia, estados controlados en backend, subsanación con versiones sobre el mismo código, panel con filtros/búsqueda/paginación/CSV sin PII, auditoría, URLs prefirmadas cortas, correos con cola y reintentos, retención y purga, documentación de costos/despliegue/datos.
Pendiente (requiere decisiones o accesos de la universidad): reglas de `docs/REGLAS_PENDIENTES.md`, conexión de cuentas reales, padrón académico, procedimiento ARCO, escaneo antimalware, pruebas de restauración de respaldos, revisión legal.
