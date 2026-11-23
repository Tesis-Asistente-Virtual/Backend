# Sprint 4C.4 — Entorno independiente de demostración

## Estado y aislamiento

La demostración usa una base local nueva, `tesis_demo_db`, y la variable exclusiva `DEMO_DATABASE_URL`. Los comandos de esta guía no consultan `DATABASE_URL` ni `TEST_DATABASE_URL` como fallback. La URL se valida por protocolo PostgreSQL, host loopback, nombre exacto de base y `NODE_ENV` distinto de `production`; luego se confirma con PostgreSQL `current_database()` y dirección de servidor loopback.

La aplicación existente obtiene su conexión de `DATABASE_URL`. El iniciador dedicado valida primero `DEMO_DATABASE_URL`, verifica la identidad de la base y, solo en su proceso hijo, la asigna a `DATABASE_URL` para reutilizar la composición actual. No modifica `.env` ni la configuración normal de `npm run dev`. Si la guarda falla, el servidor no se importa ni arranca.

El seeder de demo prepara cuatro finalidades: `ai_conversation_processing` (`demo-4c3-ai-v1`), `structured_signal_extraction` (`demo-4c3-signals-v1`), `preliminary_assessment` (`demo-5a1-assessment-v1`) y `longitudinal_monitoring` (`demo-5a1-monitoring-v1`). Las dos primeras versiones y sus textos preexistentes se conservan sin cambios; esos cuerpos heredados mencionan `tesis_test_db`, por lo que siguen siendo fixtures técnicos y no deben presentarse como avisos para uso fuera de desarrollo. Las dos últimas son fixtures nuevos con la etiqueta explícita `SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS`. Los textos de demo no constituyen avisos jurídicos ni habilitan uso con estudiantes.

No se creó la base ni se ejecutaron migraciones durante este incremento. `tesis_db` y `tesis_test_db` no fueron modificadas. `docs/sprint-4c3-isolated-demo.md` queda como guía histórica: sus comandos para sembrar en `tesis_test_db` no deben usarse porque esa base tiene avisos incompatibles.

## Requisitos

- PostgreSQL local disponible.
- Node.js y dependencias del repositorio instaladas.
- Un rol local dedicado con permisos sobre `tesis_demo_db`.
- No estar ejecutando con `NODE_ENV=production`.
- Usar exclusivamente ejemplos y cuentas sintéticas.

La creación de base y las migraciones son acciones explícitas del operador. Ningún script de arranque crea bases ni migra automáticamente.

## Procedimiento PowerShell

### 1. Crear la base manualmente

Con una sesión administrativa local de PostgreSQL, crea una base nueva cuyo propietario sea el rol local que usarás para la demo. Por ejemplo, desde `psql` conectado a una base administrativa:

```sql
CREATE DATABASE tesis_demo_db OWNER tesis_demo_user;
```

Es un comando manual deliberado. Si `tesis_demo_db` ya existe, no la borres ni la recrees para resolver conflictos; inspecciona su estado y continúa solo si confirmas que es la base aislada de demostración.

### 2. Configurar la URL solo en la sesión

Obtén la contraseña por un mecanismo local seguro y no la escribas en el historial del shell. Codifícala para URL antes de construir la variable:

```powershell
$demoDbPasswordSecure = Read-Host 'Contraseña local del rol de demo' -AsSecureString
$demoDbPassword = [System.Net.NetworkCredential]::new('', $demoDbPasswordSecure).Password
$demoDbPasswordEncoded = [Uri]::EscapeDataString($demoDbPassword)
$env:DEMO_DATABASE_URL = "postgres://tesis_demo_user:$demoDbPasswordEncoded@localhost:5432/tesis_demo_db"
Remove-Variable demoDbPassword, demoDbPasswordEncoded, demoDbPasswordSecure
```

No configures `DATABASE_URL` ni `TEST_DATABASE_URL` para estos comandos. No copies credenciales a `.env`, documentación, logs ni commits. La presencia se puede comprobar sin revelar el valor:

```powershell
if ([string]::IsNullOrWhiteSpace($env:DEMO_DATABASE_URL)) {
  throw 'DEMO_DATABASE_URL no está configurada para esta sesión.'
}
```

### 3. Verificar la conexión sin escribir

```powershell
npm run demo:verify-db
```

El comando solo verifica la conexión, `tesis_demo_db` y loopback. No migra ni escribe datos.

### 4. Aplicar las migraciones existentes, de forma explícita

Solo después de revisar el destino verificado, ejecuta:

```powershell
npm run db:migrate:demo
```

Este comando usa el migrator oficial de Drizzle y la carpeta `./drizzle`, pero su guarda acepta únicamente `DEMO_DATABASE_URL` para `tesis_demo_db` local. No utiliza `drizzle-kit db:push`, no modifica archivos de migración y no se ejecuta al iniciar el servidor. Revisa el resultado antes de continuar.

### 5. Cargar los cuatro avisos sintéticos

```powershell
npm run demo:seed-consent
```

Se publican/reutilizan los avisos de las cuatro finalidades dentro de transacción. Los dos nuevos textos llevan la etiqueta **“SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS”**. El seeder es idempotente, toma un advisory lock, inspecciona todos los propósitos antes de escribir y falla si detecta avisos incompatibles. No reemplaza, supersede ni elimina avisos publicados. Si el aviso publicado de conversación o extracción ya existe, debe coincidir exactamente con el fixture heredado; si no coincide, el seeder falla cerrado. En una base demo nueva no debe haber conflictos previos.

### 6. Ejecutar el flujo automatizado con proveedores simulados

```powershell
npm run demo:conversational
```

El runner verifica primero `tesis_demo_db` y luego corre el harness HTTP/PostgreSQL con JWT, autenticación, los cuatro avisos y eventos de consentimiento reales de esa base. El generador conversacional y el extractor son dobles deterministas: esta prueba **no llama a OpenAI**. Las cuentas de demo son sintéticas y se limpian por sus IDs al terminar; los avisos publicados permanecen inmutables en `tesis_demo_db`.

El test de integración general sigue usando `TEST_DATABASE_URL` y `tesis_test_db`; en ese modo requiere solo los dos fixtures históricos de conversación/extracción. `DEMO_HTTP_TEST_MODE` hace que el runner aislado requiera los cuatro avisos, y solo lo activa después de verificar la URL de demo.

### 7. Iniciar el servidor normal apuntando a la base de demo

Para probar Swagger, autenticación y endpoints con el servidor Express normal:

```powershell
$env:PORT = '3001'
$env:JWT_SECRET = 'synthetic-local-demo-secret-at-least-32-bytes'
npm run demo:server
```

La ruta será `http://localhost:3001/api-docs`. El iniciador valida y verifica primero la base; después arranca el servidor en ese proceso. Para permitir llamadas de generación, la composición normal requiere `OPENAI_API_KEY` y `OPENAI_MODEL`; si están configuradas, los endpoints de conversación/extracción pueden transferir contenido sintético al proveedor real cuando se invocan. No se deben llamar esos endpoints para una prueba simulada: usa `npm run demo:conversational`. Este incremento no instala un adaptador falso en la composición productiva.

Detén el servidor con `Ctrl+C`. Al cerrar la sesión, `DEMO_DATABASE_URL`, `PORT` y `JWT_SECRET` temporales dejan de estar disponibles.

## Comandos preparados

| Comando | Efecto |
| --- | --- |
| `npm run demo:verify-db` | Verificación read-only del servidor y base demo. |
| `npm run db:migrate:demo` | Aplica las migraciones ya versionadas en la base demo validada. |
| `npm run demo:seed-consent` | Verifica/prepara avisos sintéticos para las cuatro finalidades en esa base. |
| `npm run demo:conversational` | Ejecuta el harness HTTP con PostgreSQL real y proveedores simulados. |
| `npm run demo:server` | Arranca Express normal solo después de validar `tesis_demo_db`. |

**Actualización Sprint 5A.1:** el seeder conserva las dos versiones heredadas y prepara las dos finalidades adicionales para `tesis_demo_db`. En esta actualización no se ejecutaron `demo:verify-db`, migraciones, seeder ni harness; la presencia real de los cuatro avisos en PostgreSQL queda pendiente. Typecheck y build aprobaron; Vitest unitario: 263 pruebas aprobadas. No se llamó a OpenAI ni se modificaron bases.
