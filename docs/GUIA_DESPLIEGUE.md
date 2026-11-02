# Guía de despliegue: nube o servidor propio

El mismo código funciona en los dos escenarios; solo cambian variables de entorno. Elija según quién opera la infraestructura y dónde deben quedar los datos.

| | **A. Nube** (Render + PostgreSQL gestionado + Cloudflare R2 + Cloudflare Pages) | **B. Servidor propio** (VM de la UNSA con Docker) |
| --- | --- | --- |
| Costo mensual | ~USD 15–82 (ver documento de costos) | USD 0 en servicios; el costo es la VM, el disco y el tiempo de la OTI |
| Quién opera | Proveedores (parches, disponibilidad, respaldos gestionados) | La OTI/DSA: actualizaciones, respaldos, monitoreo, certificados |
| Dónde quedan los datos | EE. UU./global → **flujo transfronterizo** (Ley 29733) | En la UNSA (solo el inicio de sesión pasa por Google) |
| Archivos | `STORAGE_DRIVER=r2` | `STORAGE_DRIVER=disk` (o `s3` si la OTI ofrece almacenamiento S3) |
| Tiempo de puesta en marcha | 1–2 días | 2–5 días (depende de DNS, certificado y firewall de la OTI) |
| Escala | Automática por plan | Limitada a la VM (holgada para ~3 000 solicitudes/mes) |

En ambos casos: **Google/Firebase** para el inicio de sesión (ver `GUIA_FIREBASE.md`) y un proveedor de correo (Resend) para notificaciones.

---

## Escenario A — Nube

### A1. Base de datos
1. Cree un PostgreSQL 16 gestionado (Render *Postgres* o Neon). Producción: plan con respaldos/PITR.
2. Copie la cadena de conexión (con `sslmode=require`) → `DATABASE_URL`. Las migraciones se aplican solas al arrancar el API.

### A2. Archivos en Cloudflare R2
1. Cloudflare → **R2** → **Create bucket** `tramites-prod` (sin dominio público, sin `r2.dev`).
2. **Settings → CORS Policy → Add CORS policy** (obligatorio: el navegador sube directo a R2):
   ```json
   [{ "AllowedOrigins": ["https://tramites.unsa.edu.pe"], "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
3. **Manage R2 API Tokens → Create API token** con permiso *Object Read & Write* **solo para ese bucket** → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; además `R2_ACCOUNT_ID` y `R2_BUCKET`.

### A3. API en Render
1. Render → **New → Blueprint** → seleccione el repositorio: `render.yaml` crea el API (Docker) y la tarea diaria de retención.
2. Complete las variables marcadas `sync: false`: `DATABASE_URL`, `APP_URL`, `CORS_ORIGINS`, `ALLOWED_EMAIL_DOMAINS`, `FIREBASE_*`, `R2_*`, `RESEND_API_KEY`, `MAIL_FROM`, `BOOTSTRAP_SUPERADMINS`.
3. Plan **Starter** o superior (el Free se duerme). Verifique `https://<api>.onrender.com/api/health`.

### A4. Frontend en Cloudflare Pages
1. Pages → **Create → Connect to Git** → carpeta raíz `frontend`, comando `npm run build`, salida `dist`.
2. Variables: `VITE_API_URL=https://<api>.onrender.com` y las `VITE_FIREBASE_*` del proyecto de producción.
3. Dominio personalizado `tramites.unsa.edu.pe` (registro CNAME que crea la OTI). Añádalo en Firebase → *Authorized domains*.

### A5. Correo
Resend → verifique el dominio (registros SPF/DKIM que agrega la OTI) → `RESEND_API_KEY` y `MAIL_FROM="Trámites UNSA <tramites@unsa.edu.pe>"`.

---

## Escenario B — Servidor propio de la UNSA

Todo corre en **una máquina virtual** con Docker Compose: PostgreSQL, API y nginx (frontend + proxy + TLS). Los archivos se guardan en el disco del servidor y se entregan con **enlaces firmados de corta duración** (5 min para subir, 60 s para ver o descargar), igual que en la nube. Archivos en `deploy/servidor-propio/`.

### B1. Qué pedir a la OTI

| Recurso | Mínimo recomendado |
| --- | --- |
| VM | Ubuntu Server 24.04 LTS, 2 vCPU, 4 GB RAM |
| Disco | 40 GB sistema + **100 GB** datos (≈ 9 GB/mes de adjuntos a 3 000 solicitudes; dimensionar según retención), idealmente **cifrado (LUKS)** |
| Red | Subdominio `tramites.unsa.edu.pe` apuntando a la VM; **solo puertos 80 y 443** abiertos desde Internet (los estudiantes acceden desde fuera del campus); SSH solo desde la red de administración |
| Certificado | TLS institucional, o permiso para Let's Encrypt (requiere que el puerto 80 sea alcanzable) |
| Salida a Internet | HTTPS hacia Google (verificación de tokens) y Resend (correo) |
| Respaldo | Un destino **fuera** de la VM (NAS, otro servidor o almacenamiento institucional) |

### B2. Preparar el servidor

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh        # Docker Engine + plugin compose
sudo usermod -aG docker $USER && newgrp docker
sudo ufw allow 80,443/tcp && sudo ufw allow from <red-admin> to any port 22 && sudo ufw enable
sudo mkdir -p /opt/tramites && sudo chown $USER /opt/tramites
git clone <repositorio> /opt/tramites      # o copie la carpeta del proyecto
```

### B3. Configurar

```bash
cd /opt/tramites/deploy/servidor-propio
cp .env.example .env
openssl rand -base64 32     # → DB_PASSWORD
openssl rand -base64 48     # → STORAGE_SIGNING_SECRET
nano .env                   # URLs, Firebase, Resend, BOOTSTRAP_SUPERADMINS
chmod 600 .env
```

Certificado TLS en `deploy/servidor-propio/tls/` como `fullchain.pem` y `privkey.pem`, y el subdominio real en `nginx.conf` (`server_name`).
Con Let's Encrypt: `sudo apt install certbot && sudo certbot certonly --standalone -d tramites.unsa.edu.pe` (antes de levantar nginx) y copie o enlace los archivos de `/etc/letsencrypt/live/<dominio>/`.

### B4. Levantar

```bash
docker compose up -d --build
docker compose ps                       # db, api y web en estado running/healthy
curl -s https://tramites.unsa.edu.pe/api/health
docker compose logs -f api              # migraciones aplicadas, "Modo auth=firebase storage=disk"
```

El API **no arranca** si detecta configuración insegura (modo de prueba, clave de firma corta, URL sin https): el log indica qué corregir.

### B5. Tareas programadas (`crontab -e`)

```cron
# Retención de adjuntos según política (02:00)
0 2 * * *  cd /opt/tramites/deploy/servidor-propio && docker compose run --rm retention >> /var/log/tramites-retencion.log 2>&1
# Respaldo de base de datos y archivos (02:30), 30 días en local
30 2 * * * /opt/tramites/deploy/servidor-propio/respaldo.sh >> /var/log/tramites-respaldo.log 2>&1
# Copia del respaldo FUERA del servidor (ajuste destino) (03:30)
30 3 * * * rsync -a --delete /var/backups/tramites/ respaldo@nas.unsa.local:/respaldos/tramites/
```

**Restauración (probar cada trimestre en otra VM):**
```bash
docker compose exec -T db pg_restore -U tramites -d tramites --clean --if-exists < db-AAAAMMDD-HHMM.dump
docker run --rm -v tramites_archivos:/data -v /var/backups/tramites:/in alpine sh -c "cd /data && tar -xzf /in/archivos-AAAAMMDD-HHMM.tar.gz"
```

### B6. Actualizar a una nueva versión

```bash
cd /opt/tramites && git pull
cd deploy/servidor-propio && ./respaldo.sh && docker compose up -d --build
```

### B7. Variante: almacenamiento S3 de la universidad

Si la OTI ofrece almacenamiento compatible con S3 (Ceph, SeaweedFS, un NAS con S3, etc.), cambie en `.env` y en `docker-compose.yml`:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://archivos.unsa.edu.pe
S3_BUCKET=tramites
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

Requisitos: el endpoint debe ser **https y accesible desde los navegadores de los estudiantes**, el bucket privado y con **CORS** que permita `PUT, GET, HEAD` desde `https://tramites.unsa.edu.pe`.

### B8. Seguridad y cumplimiento en servidor propio

- Disco de datos cifrado; `.env` con permisos `600`; acceso SSH con llaves y solo desde la red de administración.
- Actualizaciones de seguridad del sistema (`unattended-upgrades`) y de las imágenes (`docker compose pull && up -d`) mensuales.
- Monitoreo mínimo: verificación externa de `/api/health` cada 5 minutos y alerta por espacio en disco > 80 %.
- Ley 29733: con este escenario los documentos y la base de datos **no salen del país**; el inicio de sesión (correo y nombre) sí pasa por Google y el correo por Resend: declárelo en la política de privacidad. Mantenga el documento de seguridad, la designación del oficial de datos personales y el procedimiento de incidentes (48 h).
- Capacidad: 3 000 solicitudes/mes ≈ 150/día hábil; la VM indicada trabaja holgada. Vigile el crecimiento del disco y ajuste `RETENTION_ATTACHMENTS_MONTHS`.

---

## Lista final antes de abrir al público

- [ ] `AUTH_MODE=firebase`, sin cuentas de prueba; dominio de producción autorizado en Firebase.
- [ ] Superadministrador creado; responsables asignados por tipo de trámite.
- [ ] Prueba completa con una cuenta real: solicitud → subsanación → emisión → encuesta de recepción.
- [ ] Correo de prueba recibido (y no en spam).
- [ ] Respaldo ejecutado **y restaurado** en otra máquina.
- [ ] Política de privacidad publicada; documento de seguridad aprobado.
