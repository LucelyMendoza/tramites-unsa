# Costos, límites gratuitos y dimensionamiento

> Fecha de verificación: **14-oct-2026**. Tipo de cambio: **S/ 3.437 por USD** (SUNAT, venta, 7-oct-2026; fuente: tucambista.pe, nota diaria). Los precios cambian: reverifique en los enlaces oficiales antes de contratar.
> Cálculos reproducibles: `python3 docs/calc_costos.py` (todos los supuestos son parámetros).

## 1. Qué es gratuito de forma permanente y qué es temporal

| Servicio | Plan gratuito | ¿Permanente? | Límites relevantes | Fuente | Calidad de la verificación |
|---|---|---|---|---|---|
| Firebase Authentication (Spark) | USD 0 | Permanente | Google sign-in sin costo dentro de la cuota. Cuota citada: **50 000 MAU** (página de precios) vs **3 000 DAU** (documentación de Identity Platform al actualizar). Con 3 000 solicitudes/mes el uso real (centenares–pocos miles de MAU, DAU < 300) cabe en ambas lecturas. | firebase.google.com/pricing · cloud.google.com/identity-platform/pricing | **Parcial**: cifras de MAU/DAU confirmadas solo por fuentes secundarias que discrepan; verificar en consola. |
| Cloudflare R2 | USD 0 hasta 10 GB-mes, 1 M ops clase A, 10 M clase B, egress gratis | Permanente | Tras la cuota: USD 0.015/GB-mes, A: USD 4.50/M, B: USD 0.36/M, **egress USD 0** | developers.cloudflare.com/r2/pricing | Oficial |
| Neon (PostgreSQL) Free | USD 0 | Permanente (no es prueba) | 1 GB/proyecto (20 GB por cuenta), 100 CU-h/proyecto, *scale-to-zero* a los 5 min (no desactivable), historial de restauración **6 horas**, egress 5 GB | neon.com/pricing | Oficial |
| Render Web Service Free | USD 0 | Permanente, pero con **suspensión tras 15 min** sin tráfico (arranque ≈ 1 min) y 750 h/mes | Inadecuado para producción | render.com/docs/free | Documentación oficial + secundarias |
| Render PostgreSQL Free | USD 0 | **Temporal: expira a los 30 días** (14 días de gracia) según doc. oficial; una fuente secundaria dice 90 | **Nunca usar con datos reales** | render.com/docs/free | Discrepancia entre fuentes; se asume el peor caso (30 d) |
| Resend Free | USD 0 | Permanente | **3 000 correos/mes y 100/día**, 1 dominio, retención de logs 30 d | resend.com/pricing | Oficial |
| Brevo Free | USD 0 | Permanente | 300 correos/día (≈ 9 000/mes) | brevo.com/pricing | Secundaria |

**Conclusión:** las pruebas con datos ficticios pueden costar **USD 0** de forma indefinida. La Base de datos gratuita de Render **no** sirve ni para pruebas prolongadas (expira); use PGlite local o Neon Free.

## 2. Precios de pago relevantes

| Servicio | Plan | Precio (USD) | S/ (×3.437) | Notas |
|---|---|---|---|---|
| Render Web Service | Starter (512 MB, 0.5 vCPU) | 7 /mes | 24.06 | Sin suspensión. Carga esperada ≈ 0.07 req/min de media: sobra. Standard (2 GB) = 25 /mes |
| Neon | Launch (pago por uso) | cómputo 0.106/CU-h · almacenamiento 0.35/GB-mes · restauración instantánea 0.20/GB-mes · historial hasta 7 días | — | Estimación 0.25 CU casi siempre activo ≈ **USD 19/mes** de cómputo; con *scale-to-zero* en horas sin uso ≈ **USD 6–12**. Sin mínimo mensual. |
| Render PostgreSQL | Basic (secundaria) | ≈ 6–7 (256 MB) · 19 (1 GB) | 21–65 | Fuente secundaria: verificar |
| Resend | Pro | 20 /mes (50 000 correos, sobrecosto 0.90/1 000) | 68.74 | Free es insuficiente: ver §4 |
| Brevo | Starter | ≈ 9 /mes | ≈ 31 | **No verificado** en página oficial |
| Dominio | .pe / .edu.pe | ≈ 10–15 /año (estimación) | ≈ 3–4 /mes | **No verificado**. Si la universidad ya tiene dominio, use un subdominio (costo 0, requiere acceso DNS para SPF/DKIM/DMARC). |

## 3. Dimensionamiento del almacenamiento (R2)

Supuestos: 3 000 solicitudes/mes · 2 adjuntos obligatorios · 20 % pasa por subsanación (+1.3 archivos nuevos, **se conservan las versiones**) · 1 PDF emitido de 0.3 MB · estado estable = volumen mensual × meses de retención (la purga elimina binarios de solicitudes FINALIZADAS tras el plazo).

| Tamaño medio por adjunto | MB/solicitud | Retención | Almacenamiento estable | R2 USD/mes | + copia de respaldo USD/mes | Total USD/mes | Total S/ /mes |
|---|---|---|---|---|---|---|---|
| 0.3 MB | 0.98 | 12 meses | 34.4 GB | 0.37 | 0.52 | 0.88 | 3.03 |
| 0.3 MB | 0.98 | 24 meses | 68.8 GB | 0.88 | 1.03 | 1.91 | 6.57 |
| 0.3 MB | 0.98 | 60 meses | 171.9 GB | 2.43 | 2.58 | 5.01 | 17.21 |
| 1.0 MB | 2.56 | 12 meses | 90.0 GB | 1.20 | 1.35 | 2.55 | 8.76 |
| 1.0 MB | 2.56 | 24 meses | 180.0 GB | 2.55 | 2.70 | 5.25 | 18.04 |
| 1.0 MB | 2.56 | 60 meses | 450.0 GB | 6.60 | 6.75 | 13.35 | 45.88 |
| 2.5 MB | 5.95 | 12 meses | 209.2 GB | 2.99 | 3.14 | 6.13 | 21.05 |
| 2.5 MB | 5.95 | 24 meses | 418.4 GB | 6.13 | 6.28 | 12.40 | 42.62 |
| 2.5 MB | 5.95 | 60 meses | 1 045.9 GB | 15.54 | 15.69 | 31.23 | 107.33 |

- **Operaciones R2**: ≈ 19 k clase A y ≈ 75 k clase B por mes → **dentro de la cuota gratuita** (1 M / 10 M). Egress: USD 0.
- **Lectura**: el almacenamiento *no* es el costo dominante, incluso a 5 años con escaneos pesados. El límite práctico es de gobernanza (cuánto tiempo se puede conservar un DNI), no económico. La política propuesta (12 meses tras finalizar) es la fila más barata.
- **PostgreSQL**: ≈ 12 KB por solicitud (fila, versiones, historial, auditoría, cola de correos) → ≈ 0.41 GB/año; ≈ 2 GB a 5 años. Cabe holgado incluso en el almacenamiento de Neon Launch (≈ USD 0.35/GB-mes).
- **Tráfico**: las cargas van directo del navegador a R2 (presigned URL), no pasan por Render. El tráfico de la API es de JSON de pocos KB.

## 4. Correos transaccionales

Hasta 6 eventos por solicitud (registrada, subsanación, reenviada, en trámite, emitida, finalizada): 3 000 × 4–6 = **12 000–18 000 correos/mes**.
- **Resend Free** (3 000/mes, 100/día): **no alcanza** ni en promedio ni en picos.
- **Resend Pro** (USD 20/mes, 50 000): cubre con holgura. API HTTPS (funciona en Render, que bloquea SMTP en el plan gratuito).
- **Brevo Free** (300/día ≈ 9 000/mes): cubriría el escenario bajo pero el tope diario es frágil en días de pico (inicio de ciclo, vencimiento de plazos); Starter ≈ USD 9 (sin verificar).
- **Recomendación**: pruebas → *Resend Free* (o `MAIL_PROVIDER=console`, sin envío). Producción → *Resend Pro*. El backend usa un contrato `MailProvider`; cambiar a Brevo/SES/Postmark exige escribir un adaptador de ~40 líneas, no tocar el resto.
- Firebase Authentication **no** envía estos correos (solo correos de autenticación propios).
- Requisito de producción: dominio verificado con **SPF, DKIM y DMARC**.

## 5. Escenario A — Desarrollo y pruebas (datos ficticios): **USD 0 / S/ 0 al mes**

| Componente | Opción | USD/mes |
|---|---|---|
| Frontend | Cloudflare Pages / Render Static (gratis) o `vite` local | 0 |
| API | Local (`npm run dev`) o Render Free (se duerme) | 0 |
| Base de datos | PGlite embebido (local) o Neon Free | 0 |
| Autenticación | Cuentas de prueba del backend (`AUTH_MODE=dev`) o Firebase Spark | 0 |
| Archivos | Almacenamiento local o R2 dentro de los 10 GB gratis | 0 |
| Correo | `console` o Resend Free | 0 |

Condiciones: solo datos ficticios; la API de Render Free tarda ≈ 1 min en despertar; Neon Free conserva solo 6 h de historial.

## 6. Escenario B — Producción, 3 000 solicitudes/mes

| Componente | Opción recomendada | USD/mes | S/ /mes |
|---|---|---|---|
| API (Node) | Render Starter | 7.00 | 24.06 |
| Frontend | Cloudflare Pages / Render Static | 0 | 0 |
| PostgreSQL | Neon Launch (restauración 7 días; sin mínimo) | 6–19 | 21–65 |
| Autenticación | Firebase Auth (Spark) | 0 | 0 |
| Archivos | R2 (1 MB/adjunto, 12 meses) | 1.20 | 4.12 |
| Respaldo de archivos | 2.º bucket, **otra cuenta** | 1.35 | 4.64 |
| Correo | Resend Pro | 20.00 | 68.74 |
| Dominio | subdominio institucional (o dominio propio ≈ 1) | 0–1 | 0–3.5 |
| Tarea de purga diaria | Render Cron (cobro mínimo no verificado; alternativa: GitHub Actions programado o ejecutar dentro de la API) | 0–1 | 0–3.4 |
| Monitoreo | Sentry/UptimeRobot en plan gratuito (no verificado) | 0 | 0 |
| **Total** | | **≈ 36–50** | **≈ 125–170** |

Rango anual: ≈ **USD 430–600 / S/ 1 500–2 060**. Cota superior pesimista (adjuntos de 2.5 MB, 5 años, Neon siempre activo, Render Standard): ≈ USD 100/mes.

### Qué debe pagarse **antes** de cargar datos personales reales
1. **API sin suspensión** (Render Starter, USD 7).
2. **PostgreSQL con respaldo y restauración** (Neon Launch o Render de pago). Los planes gratuitos tienen 6 h de historial o expiran.
3. **Correo de pago** (Resend Pro) con dominio verificado.
4. **Respaldo independiente** de R2 y de Postgres (segundo bucket en otra cuenta; costo ≈ USD 1–3).
Lo gratuito que **sí** puede quedarse en producción: Firebase Auth (Spark), R2 hasta 10 GB, frontend estático.

### Disparadores para subir de plan
- Resend: > 50 000 correos/mes → Pro 100k (USD 35) o Scale.
- Firebase: > 50 000 MAU o activar proveedores multifactor/SAML → Identity Platform (Blaze).
- Neon: > 100 CU-h de cómputo/proyecto en Free, o necesidad de historial > 7 días → Scale (restauración hasta 30 días, USD 0.222/CU-h).
- Render: latencia o memoria → Standard USD 25.

## 7. Dependencia de proveedor (lock-in) y alternativas

| Pieza | Acoplamiento en el código | Salida |
|---|---|---|
| Autenticación | Una sola clase `FirebaseVerifier` (`verifyIdToken`). Roles y usuarios viven en PostgreSQL. | Cambiar a Keycloak/Auth0/Entra ID: reemplazar el verificador de JWT; los roles no se migran. |
| Archivos | Interfaz `Storage` (presign PUT/GET, head, read, delete) con `R2Storage` (SDK S3). | Cualquier almacenamiento compatible S3 (Backblaze B2, MinIO, AWS S3, Wasabi): cambiar `R2_ENDPOINT`/credenciales. |
| Base de datos | PostgreSQL estándar, SQL propio, sin extensiones propietarias. | Neon ↔ Render ↔ RDS ↔ Supabase ↔ servidor propio con `pg_dump`/`pg_restore`. |
| Cómputo | Contenedor Docker estándar. | Render ↔ Fly.io ↔ Railway ↔ VPS institucional. |
| Correo | Interfaz `MailProvider`. | Brevo, SES, Postmark, SMTP institucional. |

## 8. Fuentes
- Firebase: https://firebase.google.com/pricing · Identity Platform: https://cloud.google.com/identity-platform/pricing
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Neon: https://neon.com/pricing
- Render: https://render.com/pricing · https://render.com/docs/free
- Resend: https://resend.com/pricing
- Brevo: https://www.brevo.com/pricing/
- Tipo de cambio SUNAT (7-oct-2026): https://tucambista.pe/noticias/dolares-a-soles-7-octubre-2026

## 9. Lo que **no** se pudo verificar
Precio de Brevo Starter y de Render Postgres de pago (solo fuentes secundarias), costo de dominio, cobro mínimo de Render Cron, si R2 exige tarjeta para el plan gratuito, las cifras exactas de MAU/DAU de Firebase Spark, y precios de Backblaze B2 (no investigado). Ninguno cambia la conclusión, pero deben confirmarse al contratar.
