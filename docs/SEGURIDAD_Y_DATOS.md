# Seguridad y protección de datos personales

> Este documento es una guía técnica, **no asesoría legal**. Debe revisarlo el Oficial de Datos Personales y la asesoría jurídica de la universidad.

## 1. Marco normativo (Perú)
- **Ley N.º 29733**, Ley de Protección de Datos Personales, y su **nuevo Reglamento, D.S. N.º 016-2024-JUS**, vigente desde el **30-mar-2025**.
- Puntos del reglamento que impactan este sistema (verificar texto vigente): política/documentación de seguridad, **notificación de incidentes de seguridad a la autoridad en un máximo de 48 horas**, designación de un **Oficial de Datos Personales** en entidades públicas, registro de bancos de datos, derechos ARCO.
- Datos tratados: nombre, **DNI** (y su imagen/PDF), CUI, correo institucional, situación académica, declaración jurada. No se tratan datos sensibles en sentido estricto (salud, etc.), pero la copia del DNI exige tratamiento reforzado.

## 2. Controles implementados
| Principio | Control en el sistema |
|---|---|
| Acceso mínimo | Roles `superadmin/reviewer/issuer` + alcance por facultad aplicado en cada consulta; 404 para recursos ajenos |
| Autenticación | Google institucional (Firebase), validación **en backend** de dominio, `email_verified`, `hd`, y revocación de tokens |
| Escalada | No existe API para otorgar roles; solo CLI/bootstrap en el servidor. `PATCH /api/me` rechaza cualquier campo distinto de `applicantType` |
| Confidencialidad de archivos | Bucket privado; URL prefirmada de 60 s (descarga) / 5 min (subida) tras validar propiedad, alcance y estado; claves aleatorias sin datos personales |
| Integridad de archivos | Validación de contenido real, tamaño, extensión/MIME, marcadores de PDF activos, SHA-256; versiones inmutables |
| Trazabilidad | `audit_log` de cada vista de solicitud, descarga, cambio de estado, exportación, alta de catálogo y retención; `status_history` por solicitud |
| Minimización | Correos sin adjuntos ni DNI/CUI; exportación CSV sin DNI/CUI/nombre; DNI visible solo para personal autorizado; logs sin cabecera `Authorization` |
| Exportación segura | Solo permisos `report:export`; inyección de fórmulas neutralizada; cada exportación auditada |
| Declaración jurada | Se registra texto exacto, versión, fecha, usuario e IP; **no** equivale a autorización verificada; `declaration_verified` puede exigirse para finalizar |
| Limitación de abuso | Rate limiting (`@fastify/rate-limit`), límite de cargas pendientes por solicitud, tope de tamaño, cuerpo máximo acotado |
| Separación de entornos | El arranque en producción falla si hay modo dev, almacenamiento local o correo de consola |

## 3. Política de conservación **propuesta** (a validar)
| Dato | Plazo propuesto | Mecanismo |
|---|---|---|
| Adjuntos del solicitante (DNI, boleta) y sus versiones | **12 meses** tras `FINALIZADA` (`RETENTION_ATTACHMENTS_MONTHS`) | `npm run retention:purge` diario (Render Cron): borra el objeto y deja `status='purged'`; se conserva el metadato |
| Documento emitido | a definir con **Archivo Central** (suele exigir conservación mayor) | no purgado automáticamente |
| Registro del trámite (datos, historial, declaración) | a definir (norma archivística / control interno) | no purgado automáticamente |
| Auditoría | ≥ 5 años sugerido | no purgado automáticamente |
| Borradores abandonados | 30 días | purga diaria |
| Cargas huérfanas (pendientes > 1 día) | 1 día | purga diaria |
| Cola de correos enviados | 12 meses sugerido | pendiente de script |
`npm run retention:purge -- --dry-run` informa sin borrar. Los plazos son **propuestas técnicas**: deben validarse (ver `REGLAS_PENDIENTES.md`).

## 4. Derechos ARCO y baja
El sistema permite localizar todos los datos de una persona por DNI/correo. **Pendiente (no implementado):** procedimiento institucional y herramienta para atender acceso, rectificación, cancelación y oposición, que debe conciliarse con las obligaciones de conservación archivística.

## 5. Respuesta a incidentes (plan mínimo)
1. Detectar (alertas de acceso inusual en `audit_log`, picos de descargas, avisos del proveedor).
2. Contener: revocar claves R2/Resend/Firebase de servicio, `staff:revoke`, rotar `DEV_AUTH_SECRET` si aplica, cerrar el bucket.
3. Evaluar alcance con `audit_log` (qué solicitudes/archivos se vieron o descargaron y por quién).
4. **Notificar a la autoridad en ≤ 48 h** (por el Oficial de Datos Personales) y a los afectados cuando corresponda.
5. Documentar lecciones aprendidas y corregir.

## 6. Riesgos residuales y decisiones abiertas
- **Cifrado en reposo** lo aporta el proveedor; no hay cifrado de campo. Decisión pendiente si la política exige cifrar el DNI en columna.
- **Antivirus**: se valida contenido y se bloquean PDF activos, pero no hay escaneo antimalware. Opción futura: ClamAV en un worker sobre el objeto antes de marcar `verified`.
- **Dependencia de proveedores en el extranjero** (Google, Cloudflare, Neon/Render, Resend): evaluar **transferencia internacional de datos** y cláusulas contractuales con la asesoría legal. Elegir regiones cercanas reduce latencia, no resuelve el aspecto legal.
- **Doble factor** para administradores: se delega en la política de la cuenta Google institucional; conviene exigir verificación en dos pasos en el Workspace de la universidad.
- **Padrón académico**: la verificación de alumno/egresado es solo informativa mientras no exista integración real.
