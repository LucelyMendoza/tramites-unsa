# Guía paso a paso: inicio de sesión con Google (Firebase)

> Resultado: estudiantes, egresados y personal ingresan con su cuenta **@unsa.edu.pe**.
> En desarrollo conviven Google y las cuentas de prueba (`AUTH_MODE=hybrid`); en producción solo Google (`AUTH_MODE=firebase`).
> Tiempo estimado: 20–30 minutos. Costo: USD 0 hasta 50 000 usuarios activos al mes.

## Antes de empezar

- Use una cuenta de Google **institucional** de la DSA o de la OTI (no personal): el proyecto debe quedar a nombre de la universidad.
- Si el proyecto se crea dentro de la organización Google Workspace de la UNSA, podrá limitar el acceso a cuentas `@unsa.edu.pe` también en el lado de Google (paso 7). Es la opción recomendada.
- Cree **dos proyectos**: `tramites-unsa-dev` (pruebas) y `tramites-unsa-prod` (producción). Nunca comparta credenciales entre ambos.

## 1. Crear el proyecto

1. Entre a <https://console.firebase.google.com> con la cuenta institucional.
2. **Agregar proyecto** (*Create a project*) → nombre `tramites-unsa-dev`.
3. Google Analytics: **desactivado** (no se necesita y evita tratar datos adicionales).
4. **Crear proyecto** y espere a que termine.

## 2. Activar el proveedor Google

1. En el menú del proyecto abra **Authentication** (en la consola actual está dentro de la sección *Security*; en versiones anteriores, *Compilación / Build*).
2. Si es la primera vez: **Comenzar** (*Get started*).
3. Pestaña **Sign-in method** → **Google** → **Habilitar**.
4. **Correo de asistencia del proyecto**: el correo institucional de la DSA.
5. **Guardar**.

No active otros proveedores (correo/contraseña, teléfono, etc.): el backend rechaza cualquier inicio de sesión que no sea Google.

## 3. Dominios autorizados

**Authentication → Settings (Configuración) → Authorized domains**:

| Entorno | Dominios |
| --- | --- |
| Desarrollo | `localhost` (viene por defecto) |
| Producción | el subdominio institucional, p. ej. `tramites.unsa.edu.pe` (y el dominio de Cloudflare Pages si lo usa) |

Si falta un dominio, el navegador muestra `auth/unauthorized-domain`.

## 4. Registrar la aplicación web y copiar su configuración

1. Ícono de engranaje → **Configuración del proyecto** → pestaña **General**.
2. En **Tus apps** pulse el ícono **Web** (`</>`) → apodo `tramites-web` → **Registrar app** (no marque Hosting).
3. Copie los valores del bloque `firebaseConfig` en **`frontend/.env`**:

```env
VITE_FIREBASE_API_KEY=AIza...            # apiKey
VITE_FIREBASE_AUTH_DOMAIN=tramites-unsa-dev.firebaseapp.com   # authDomain
VITE_FIREBASE_PROJECT_ID=tramites-unsa-dev                    # projectId
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123                  # appId
VITE_HOSTED_DOMAIN=unsa.edu.pe
```

Estos valores **no son secretos** (viajan al navegador). La seguridad está en el backend, que verifica cada token.

## 5. Configurar el backend

En **`backend/.env`**:

```env
AUTH_MODE=hybrid                 # desarrollo: Google + cuentas de prueba. Producción: firebase
FIREBASE_PROJECT_ID=tramites-unsa-dev
ALLOWED_EMAIL_DOMAINS=unsa.edu.pe
```

Con solo `FIREBASE_PROJECT_ID` el backend ya verifica la firma, el emisor, la audiencia y la expiración del token.
Para que además rechace sesiones **revocadas** (p. ej. al dar de baja a alguien), agregue la cuenta de servicio:

1. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada** → se descarga un `.json`.
2. Conviértalo a una sola línea y péguelo:
   ```bash
   # macOS / Linux
   python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" clave.json
   ```
   ```env
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"tramites-unsa-dev",...}
   ```
3. Guarde el `.json` original fuera del repositorio (gestor de secretos de la OTI) y bórrelo de Descargas.

## 6. Probar

1. Reinicie el sistema (`./iniciar.command` o `npm run dev` en backend y frontend).
2. En la pantalla de inicio, **Continuar con Google** ya no aparece deshabilitado.
3. Pruebe tres casos:
   - Cuenta `@unsa.edu.pe` → entra al portal del solicitante.
   - Cuenta `@gmail.com` → mensaje «Su cuenta no está autorizada» (lo rechaza el backend, no solo el navegador).
   - Cuenta de prueba (solo en `hybrid`) → sigue funcionando.

## 7. Pantalla de consentimiento de Google (marca y restricción)

En <https://console.cloud.google.com> con el **mismo proyecto** seleccionado → **Google Auth Platform** (antes *Pantalla de consentimiento de OAuth*):

- **Branding**: nombre «Trámites UNSA – DSA», logo, correo de asistencia, enlaces a la política de privacidad del sistema.
- **Audience / Público**:
  - **Interno** (solo si el proyecto pertenece a la organización Workspace de la UNSA): Google solo permite cuentas `@unsa.edu.pe`. Doble barrera junto al backend.
  - **Externo**: cualquier cuenta Google puede intentar ingresar y el backend rechaza las no institucionales. Publique la app (*En producción*); con los permisos básicos (correo y perfil) no requiere verificación de Google.

## 8. Dar roles al personal

Todo usuario nuevo entra como **solicitante**. Los roles se otorgan solo desde el servidor:

```bash
cd backend
npm run staff:grant -- maria.perez@unsa.edu.pe reviewer      # revisor
npm run staff:grant -- jefe.dsa@unsa.edu.pe superadmin       # superadministrador
npm run staff:list
npm run staff:revoke -- maria.perez@unsa.edu.pe
```

En producción, el primer superadministrador se define con `BOOTSTRAP_SUPERADMINS=correo@unsa.edu.pe`; los demás se asignan después. Luego, en **Responsables y ausencias**, asigne qué trámites atiende cada persona.

## 9. Paso a producción

1. Repita los pasos 1–5 en `tramites-unsa-prod`.
2. Backend: `AUTH_MODE=firebase`, `DEV_TEST_ACCOUNTS_ENABLED=false` (el servidor **no arranca** si quedan cuentas de prueba o modo híbrido en producción).
3. Agregue el dominio de producción en *Authorized domains*.
4. Opcional: en Google Cloud → *APIs y servicios → Credenciales*, restrinja la API key del navegador por **referente HTTP** al dominio de producción.

## Problemas frecuentes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Botón de Google deshabilitado | Faltan `VITE_FIREBASE_*` o `FIREBASE_PROJECT_ID` | Complete ambos `.env` y reinicie |
| `auth/unauthorized-domain` | Dominio no autorizado | Paso 3 |
| `auth/operation-not-allowed` | Proveedor Google no activado | Paso 2 |
| La ventana emergente se cierra o no abre | Bloqueador de ventanas emergentes | Permitirlas para el sitio; en móviles, si persiste, se puede cambiar a inicio por redirección |
| «Token inválido o expirado» (401) | `FIREBASE_PROJECT_ID` del backend ≠ proyecto del frontend | Use el mismo proyecto en ambos `.env` |
| «Solo se permiten cuentas institucionales» (403) | Cuenta fuera de `ALLOWED_EMAIL_DOMAINS` | Esperado. Ver pendiente de egresados ↓ |

## Pendiente institucional: egresados

Los egresados podrían no conservar su cuenta `@unsa.edu.pe`. Si es así, la DSA debe decidir una vía (p. ej. mantener la cuenta institucional del egresado, o aceptar una cuenta Google personal **verificada contra el padrón de egresados**). Hasta decidirlo, solo ingresan cuentas institucionales.
