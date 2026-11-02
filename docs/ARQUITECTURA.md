# Arquitectura

```
Navegador (React + TS + Tailwind) ──HTTPS──► API Node/Fastify (Render) ──► PostgreSQL (Neon / Render / otro)
   │  ▲                                          │   │
   │  └── JWT Firebase (Google institucional)    │   └──► Cola de correos (outbox en Postgres) ──► Resend
   │                                              │
   └── PUT/GET con URL prefirmada (5 min / 60 s) ─┴──► Cloudflare R2 (bucket PRIVADO)
```

## Decisiones
- **Backend Node 22 + Fastify 5 + TypeScript** (la especificación admitía «Laravel o equivalente»). Motivo: un solo lenguaje con el frontend, contenedor ligero (≈ 150 MB RAM) y pruebas rápidas.
- **PostgreSQL real también en desarrollo y pruebas** mediante PGlite (Postgres compilado a WASM, embebido): mismas consultas, mismas restricciones, sin instalar nada. En producción se usa `DATABASE_URL` con `pg`.
- **Los archivos nunca pasan por la API**: el navegador pide una URL prefirmada, sube directo a R2 y luego llama a `/complete`; la API lee el objeto, comprueba tamaño, **contenido real (magic bytes)**, coherencia extensión/MIME y marcadores riesgosos de PDF (`/JavaScript`, `/Launch`, `/OpenAction`…), calcula SHA-256 y recién entonces lo marca `verified`.
- **Estados controlados solo por el backend**: `applyTransition()` es el único punto que cambia `requests.status`; escribe `status_history`, `audit_log` y encola el correo en la **misma transacción**.
- **Correos con outbox transaccional**: si la transacción falla no hay correo; si confirma, no se pierde aunque Resend falle. Reintentos con backoff 1/5/15/60/240/720/1440 min, máx. 8 intentos (`dead`), `dedupe_key` único e `Idempotency-Key` hacia el proveedor, `FOR UPDATE SKIP LOCKED` (varias instancias seguras).
- **Roles**: `staff_roles` en la base de datos (`superadmin`, `reviewer`, `issuer`, con `faculty_scope` opcional). No existe endpoint para otorgarlos: solo `npm run staff:grant` (consola del servidor) o `BOOTSTRAP_SUPERADMINS`. El token de Firebase **no** transporta roles.

## Módulos del backend (`backend/src`)
| Módulo | Contenido |
|---|---|
| `config.ts` | Variables de entorno validadas con zod; en producción **rechaza** `AUTH_MODE=dev`, `STORAGE_DRIVER=local`, `MAIL_PROVIDER=console` y falta de `DATABASE_URL`. |
| `auth/` | `FirebaseVerifier` (`verifyIdToken` con revocación), `DevVerifier` (HMAC, solo desarrollo), lista blanca de dominios, `email_verified` y `hd`. |
| `domain/` | Máquina de estados, configuración dinámica de trámites, validadores (DNI/CUI/nombre), matriz de permisos, padrón académico (interfaz). |
| `storage/` | `Storage` + `R2Storage` / `LocalStorage` (dev), sniffing de archivos, claves aleatorias de 192 bits (`att/…`, `iss/…`). |
| `notifications/` | Plantillas (sin PII ni adjuntos), outbox, proveedores `resend` y `console`. |
| `modules/` | `applicant`, `admin`, `meta` (rutas HTTP) y `service` (auditoría, alcance, transición única). |
| `db/` | Cliente, ejecutor de migraciones SQL versionadas (`schema_migrations`). |
| `scripts/` | `migrate`, `seed` (catálogo ficticio «[PRUEBA]»), `staff`, `retention`. |

## Modelo de datos (PostgreSQL, `001_init.sql`)
`faculties` → `schools` → `programs` · `tramite_types` (config `jsonb` versionada) · `users` · `staff_roles` · `requests` (código único `TD-AAAA-NNNNNN`, `type_data jsonb`, `edited_fields`, `resubmit_count`) · `request_counters` · `request_files` (slot, **versión**, `object_key` único, estado, `is_current` con índice único parcial, sha256) · `observations` (nota/subsanación, `targets`, `resolved_at`) · `status_history` · `declarations` (texto, versión, fecha, IP, estado de verificación) · `issued_documents` · `notifications` (outbox) · `audit_log`.
Índices por usuario, estado, facultad, escuela, tipo, DNI, CUI, asignado y fecha de envío (21 índices/restricciones únicas). Solo **metadatos** de archivos viven en Postgres; los binarios, en R2.

## Flujo de estados
`BORRADOR → ENVIADA → EN_REVISION → (REQUIERE_SUBSANACION ↔ REENVIADA → EN_REVISION) → EN_TRAMITE → EMITIDA → FINALIZADA`
- La subsanación mantiene **el mismo expediente y código**; el solicitante solo puede cambiar lo observado (`targets`), y no puede reenviar sin haberlo corregido (se verifica que el archivo observado tenga `verified_at` posterior a la observación).
- `FINALIZADA` exige las condiciones del trámite (`issued_document` y, si se configura, `declaration_verified`).

## Permisos
| Permiso | superadmin | reviewer | issuer |
|---|---|---|---|
| Ver solicitudes / documentos | ✔ | ✔ | ✔ |
| Revisar, pedir subsanación, aprobar, notas | ✔ | ✔ | — |
| Asignar responsable | ✔ | ✔ | — |
| Verificar declaración de Posgrado | ✔ | ✔ | — |
| Cargar documento emitido, emitir, finalizar | ✔ | — | emitir/finalizar ✔ |
| Exportar CSV | ✔ | ✔ | — |
| Catálogo, auditoría, cola de correos, personal | ✔ | — | — |
`faculty_scope` restringe todas las consultas y acciones a las facultades asignadas (un recurso fuera de alcance responde 404).

## API (resumen)
Solicitante: `POST/PUT /api/requests`, `GET /api/requests[/:id]`, `POST …/files/presign`, `…/files/:id/complete`, `POST …/submit`, `GET /api/files/:id/download-url`, `GET /api/issued/:id/download-url`, `GET /api/me/notifications`.
Admin: `GET /api/admin/stats|requests|requests/:id|requests/export.csv|assignees|audit|staff|notifications`, `POST …/review|notes|assign|declaration/verify|issued/presign|issued/:id/complete|emit|finalize`, `GET/POST/PUT /api/admin/tramite-types`.

## Frontend (`frontend/src`)
React 19 + React Router + Tailwind 4. Portal del solicitante (`/`, `/nuevo`, `/solicitud/:id`) y panel administrativo **separado** (`/admin/*`, otro layout). Las rutas ocultas son solo comodidad: **cada acción se vuelve a autorizar en el backend**. Con `VITE_FIREBASE_*` inicia con Google; sin ellas (y con `AUTH_MODE=dev`) muestra el selector de cuentas de prueba, con banner permanente de «MODO DE PRUEBA».
