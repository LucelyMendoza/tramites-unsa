# Reglas institucionales pendientes de confirmar

El sistema **no inventa** reglas. Todo lo que sigue está implementado de forma **configurable** y marcado como pendiente; el catálogo guarda las notas en `pendingRules` y el panel las muestra.

| # | Regla | Estado actual en el código | Quién debe confirmarla |
|---|---|---|---|
| 1 | **Formato del CUI** | `CUI_PATTERN` (por defecto solo dígitos `^\d+$`). Sin longitud ni dígito verificador | Oficina de Registro/Matrícula / Servicios Académicos |
| 2 | **Dígito verificador del DNI** | Solo 8 dígitos; no se calcula verificador | Decisión institucional (RENIEC) |
| 3 | **Campos de Constancias** (tipos, años, finalidad) | Sin campos adicionales; documentos base (boleta + DNI) | Servicios Académicos |
| 4 | **Campos de Ranking** (periodo, promoción, etc.) | Sin campos adicionales | Servicios Académicos |
| 5 | **Posgrado / Segundas especialidades**: documentos exigidos y procedimiento de verificación de la autorización | Declaración jurada + estado `pendiente/verificada/rechazada`; `declaration_verified` opcional para finalizar | Unidad de Posgrado y Secretaría |
| 6 | **Certificado**: años/periodos permitidos | Selector multi-año (hasta 15 años atrás, máx. 10 selecciones) | Servicios Académicos |
| 7 | **Documentos exigidos por tipo** (¿boleta de pago siempre?, ¿monto?) | BOLETA (PDF) y DNI (PDF/JPG/PNG) en todos | Tesorería / Servicios Académicos |
| 8 | **Plazos de conservación** de adjuntos, emitidos y registros | 12 meses para adjuntos (propuesta); resto sin purga | Archivo Central, Control Interno, Oficial de Datos Personales |
| 9 | **Catálogo oficial** de facultades, escuelas y programas | Datos ficticios «[PRUEBA]» | Planeamiento / Registro |
| 10 | **Padrón académico** para validar alumno/egresado | Interfaz `DirectoryProvider` (`none` / `fixture`); informativo | Oficina de Tecnologías de la Información |
| 11 | **Dominio institucional** exacto (¿`unsa.edu.pe`? ¿subdominios para alumnos?) | `ALLOWED_EMAIL_DOMAINS` (por defecto `unsa.edu.pe`) | OTI |
| 12 | **Quién puede finalizar** y condiciones | `issuer`/`superadmin`; `issued_document` obligatorio | Dirección de Servicios Académicos |
| 13 | **Numeración de expedientes** | `TD-AAAA-NNNNNN` correlativo anual | Mesa de Partes / Archivo |
| 14 | **Texto de la declaración** | Texto literal solicitado, versión `v1` | Asesoría jurídica |

Para cada trámite, edite *Panel → Catálogo → Editar* (JSON validado por el backend): documentos, campos (`multi-year`, `text`, `select`), `requiresDeclaration`, `finalizeRequires` y `pendingRules`. Cada cambio incrementa `version`; las solicitudes guardan la versión con la que se crearon.
