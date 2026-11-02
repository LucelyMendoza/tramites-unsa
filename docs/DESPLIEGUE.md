# Instalación, pruebas y despliegue

## 1. Desarrollo local (sin cuentas externas)
```bash
cd backend && cp .env.example .env && npm install
npm test                 # 61 pruebas: flujo, seguridad, outbox, unitarias
npm run dev              # API en :4000 (PostgreSQL embebido en memoria, almacenamiento local, correo por consola)
cd ../frontend && cp .env.example .env && npm install
npm run dev              # http://localhost:5173 (proxy /api → :4000)
```
Cuentas de prueba (solo `AUTH_MODE=dev`): `estudiante1@`, `egresado1@`, `revisor@`, `emisor@`, `admin@unsa.edu.pe` (dominio = primer `ALLOWED_EMAIL_DOMAINS`). Bandeja de correos simulada: `GET /api/dev/mailbox`. Persistir datos: `PGLITE_DIR=.data/pg`.
> Los correos y archivos de este modo **no** salen a ningún servicio real. Nada de esto se presenta como conectado a servicios reales.

## 2. Separación de entornos
| | Desarrollo | Staging (opcional, recomendado) | Producción |
|---|---|---|---|
| Datos | ficticios «[PRUEBA]» | ficticios | reales |
| `AUTH_MODE` | `dev` | `firebase` (proyecto Firebase **distinto**) | `firebase` |
| BD | PGlite | Neon Free / rama | Neon Launch (u otra) con respaldo |
| Archivos | `local` | bucket R2 `…-staging` | bucket R2 `…-prod` (+ bucket de respaldo en otra cuenta) |
| Correo | `console` | Resend Free (destinatarios propios) | Resend Pro, dominio verificado |
| Credenciales | `.env` local | panel de Render (entorno staging) | panel de Render (entorno prod), **claves distintas** |
Una credencial de staging nunca debe abrir producción: proyectos, buckets, claves R2 y claves de Resend separados.

## 3. Conectar servicios reales (orden sugerido)
1. **Firebase**: crear proyecto → Authentication → habilitar solo **Google** → dominios autorizados = URL del frontend. En *Configuración → Cuentas de servicio* generar clave y pegar el JSON **en una línea** en `FIREBASE_SERVICE_ACCOUNT_JSON`. `ALLOWED_EMAIL_DOMAINS=unsa.edu.pe` (el backend rechaza otros dominios aunque Firebase los admita). Frontend: `VITE_FIREBASE_*` (config pública).
2. **PostgreSQL**: crear proyecto Neon (región cercana: `sa-east-1` São Paulo si está disponible) → `DATABASE_URL` con `sslmode=require`. Las migraciones se aplican al iniciar la API.
3. **Cloudflare R2**: crear bucket **privado** (sin dominio público ni acceso r2.dev). Token S3 limitado a ese bucket (Object Read & Write). Configurar **CORS** del bucket: orígenes = URL del frontend; métodos `PUT, GET, HEAD`; cabeceras `Content-Type`; `ExposeHeaders: ETag`. Variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
4. **Resend**: verificar dominio (SPF, DKIM, DMARC) → `RESEND_API_KEY`, `MAIL_FROM` en ese dominio.
5. **Render**: `render.yaml` crea la API (Docker) y la tarea de purga. Rellenar las variables marcadas `sync: false`. `APP_URL` y `CORS_ORIGINS` = URL del frontend. Salud: `/api/health`.
6. **Primer administrador**: `BOOTSTRAP_SUPERADMINS=correo@unsa.edu.pe` (se aplica al arrancar). Luego, desde la consola de Render: `node dist/scripts/staff.js grant correo@unsa.edu.pe reviewer [idFacultad,…]` (ver `staff:list`). Quitar o dejar solo el superadmin real en `BOOTSTRAP_SUPERADMINS`.
7. **Catálogos reales**: sustituir facultades/escuelas/programas ficticios (cargar mediante SQL o un script propio con los datos oficiales) y ajustar los trámites en *Panel → Catálogo*. `ACADEMIC_DIRECTORY=none` hasta integrar el padrón real. Ver `REGLAS_PENDIENTES.md`.
8. **Frontend**: Cloudflare Pages / Render Static: `npm run build`, publicar `dist/`, con `VITE_API_URL` (URL de la API) y `VITE_FIREBASE_*`.

## 4. Cifrado
- **En tránsito**: HTTPS/TLS en Render, R2, Neon y Resend; `sslmode=require` en Postgres; cabeceras de seguridad con Helmet.
- **En reposo**: R2 y los proveedores de PostgreSQL cifran discos/objetos del lado del proveedor (AES-256 según su documentación; **confirmar por escrito en cada proveedor al contratar**). La aplicación no cifra columnas adicionales; si la política institucional exige cifrado a nivel de campo para DNI, requiere una decisión de diseño adicional (impacta la búsqueda por DNI).
- Las claves de objeto son aleatorias e impredecibles; las URL prefirmadas de descarga duran 60 s y se generan solo tras validar propiedad/alcance.

## 5. Respaldos y recuperación
**Un bucket no es un respaldo**: borrar o sobrescribir un objeto lo pierde.
| Dato | Respaldo | Frecuencia | Retención | Recuperación |
|---|---|---|---|---|
| PostgreSQL | Restauración instantánea del proveedor (Neon Launch: hasta 7 días) **+** `pg_dump` cifrado semanal a un bucket de otra cuenta | continuo + semanal | 7 días + 12 semanas | Restaurar al punto en el tiempo; o `pg_restore` del volcado |
| R2 (adjuntos y emitidos) | Replicación a un **segundo bucket en otra cuenta** (`rclone copy` programado, p. ej. desde GitHub Actions o un cron) **sin** propagar borrados (usar `copy`, no `sync`, o versionado) | diaria | ≥ la retención de la solicitud | Copiar de vuelta; las claves se conservan, por lo que las filas de `request_files` siguen válidas |
| Configuración | `render.yaml`, variables en gestor de secretos de la institución | en cada cambio | — | Reaplicar blueprint |
Pruebas de restauración: **trimestrales**, en staging, documentando tiempo (RTO) y pérdida (RPO). Objetivos sugeridos: RPO ≤ 24 h, RTO ≤ 4 h.
Ejemplo: `pg_dump "$DATABASE_URL" -Fc | age -r <clave-pública> > tramites-$(date +%F).dump.age`

## 6. Monitoreo
- `/api/health` con *uptime monitor* externo (alerta si falla 3 veces seguidas).
- Revisar a diario la pestaña **Auditoría y correos**: correos `dead` (reintentar tras corregir el proveedor).
- Registros de Render (pino, sin cabecera `Authorization`). Alertas de cuota de R2 y de correo.
- Tras un incidente con datos personales: ver `SEGURIDAD_Y_DATOS.md` (notificación en 48 h).

## 7. Checklist previo a producción
- [ ] `NODE_ENV=production`, `AUTH_MODE=firebase`, `STORAGE_DRIVER=r2`, `MAIL_PROVIDER=resend` (el arranque falla si no).
- [ ] `DEV_TEST_ACCOUNTS_ENABLED=false`; sin banner de «MODO DE PRUEBA» en el frontend.
- [ ] Bucket privado + CORS mínimo; claves distintas a staging.
- [ ] Dominio de correo con SPF/DKIM/DMARC.
- [ ] Respaldos configurados y **una restauración probada**.
- [ ] Reglas pendientes cerradas (`REGLAS_PENDIENTES.md`) y política de datos aprobada por el Oficial de Datos Personales.
- [ ] `npm test` en verde sobre el commit desplegado.
