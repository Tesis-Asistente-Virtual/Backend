# Sprint 4C.3 — Demo conversacional aislada

> **Procedimiento histórico.** Los avisos publicados existentes en `tesis_test_db` son incompatibles con estos fixtures y no deben cambiarse. No ejecutes aquí `demo:seed-test-consent` ni `demo:conversational`. Para el entorno independiente actual, sigue [Sprint 4C.4](./sprint-4c4-demo-environment.md), que usa exclusivamente `DEMO_DATABASE_URL` y `tesis_demo_db`.

## Estrategia

La demostración es un harness de integración HTTP efímero, no el servidor normal de desarrollo. Compone los controladores y casos de uso existentes sobre una conexión PostgreSQL verificada como `tesis_test_db`, emite JWT con el servicio real, usa los endpoints de consentimiento/conversación/extracción y sustituye tanto la generación del chat como la extracción por dobles deterministas. No hay llamada a OpenAI, bypass de autorización, endpoint mock público, persistencia de resultados ni cambio del comportamiento productivo.

El harness ejercita el registro y login a través de sus controllers y casos de uso reales. Su montaje aislado no incluye el middleware rate limit de producción para sign-in; sirve como demostración funcional del flujo, no como prueba de configuración de despliegue.

## Guardas de base de datos

Los comandos usan exclusivamente `TEST_DATABASE_URL` mediante `connectTestDatabase()` de `tests/integration/test-database.ts`. Antes de devolver un handle Drizzle, el helper requiere URL PostgreSQL con path `/tesis_test_db`, host loopback y confirma en el servidor `current_database() = tesis_test_db` y dirección loopback. No hay fallback a `DATABASE_URL`.

La carga se ejecuta dentro de una transacción y toma un advisory transaction lock para serializar dos seeders. La transacción inspecciona ambos propósitos antes de insertar o publicar avisos. Si detecta conflicto, no escribe borradores. Si una restricción falla durante la escritura, la transacción revierte todo. Los avisos publicados son inmutables y solo puede haber uno por finalidad. No se ejecutan migraciones ni `db:push`; la base de prueba debe tener previamente el esquema requerido.

En el entorno donde se preparó este incremento, `TEST_DATABASE_URL` no estaba definida. Por eso no se conectó a PostgreSQL, no se escribieron fixtures y no se ejecutó la integración. La ruta verificada para lanzar los comandos se describe abajo.

## Diagnóstico de conflictos (solo lectura)

Antes de decidir qué hacer si el seeder aborta, ejecuta:

```powershell
npm run demo:diagnose-test-consent
```

El comando usa la misma guarda de conexión y hace únicamente consultas `SELECT` sobre los avisos de `ai_conversation_processing` y `structured_signal_extraction`. No abre una transacción de escritura, no ejecuta el seeder y no cambia registros. Imprime una línea JSON por finalidad con `purpose`, `version`, `status`, `compatible` y un motivo cerrado. No imprime contenido, IDs, URLs ni credenciales.

Motivos y tratamiento seguro:

| Motivo | Interpretación | Opción segura |
| --- | --- | --- |
| `ready_to_create` | No hay aviso para la versión del fixture y no hay publicado incompatible. | La carga puede insertar los borradores sintéticos y publicarlos en `tesis_test_db`. |
| `ready_to_publish` | Existe el borrador exacto del fixture, aún vigente. | La carga puede publicar ese borrador. |
| `already_published` | Ya está publicada la misma versión/contenido/hash y es vigente. | No se requiere cambio; la carga es idempotente. |
| `published_notice_incompatible` | La finalidad ya tiene un aviso publicado distinto. | No reemplazarlo. Usar una instancia local de `tesis_test_db` aislada para demo o detener la demo. |
| `version_duplicate` | La versión esperada ya existe, pero está superseded u otro estado no publicable. | No reutilizar ni modificarla; elegir una nueva versión de fixture en una revisión de código. |
| `draft_content_mismatch` | Existe un borrador con la versión esperada y contenido distinto. | No sobrescribirlo; usar una nueva versión de fixture o una base aislada. |
| `content_hash_mismatch` | El hash persistido no corresponde al contenido fijo del fixture. | Tratarlo como inconsistencia; no alterar el aviso, escalar revisión de base o usar una instancia aislada. |
| `effective_date_in_future` | El aviso coincide, pero su fecha efectiva aún no llegó. | No cambiar fechas de un registro existente; esperar o usar una nueva versión en una base aislada. |
| `multiple_published_notices` | La lectura encontró más de un publicado para una finalidad, contrario al índice único. | No modificar filas desde la demo; investigar el estado de la base antes de continuar. |

Los fixtures no asignan UUID explícitos: PostgreSQL los genera. Por eso un UUID primario ocupado no puede detectarse de antemano mediante esta consulta; una improbable colisión al insertar se reportaría como `constraint_violation` y la transacción revertiría. Una carrera con otro escritor que no use el advisory lock también puede aparecer después del diagnóstico; el índice único sigue siendo la defensa final.

En la versión actual del seeder, `fixture_conflict` trae además el campo seguro `reason`; no incluirá IDs ni contenido. El diagnóstico reporta el estado de la base al momento de la consulta y no garantiza que otro proceso no lo cambie después.

## Avisos de fixture

Solo se preparan estas finalidades:

| Finalidad | Versión | Etiqueta y contenido |
| --- | --- | --- |
| `ai_conversation_processing` | `demo-4c3-ai-v1` | `SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS.`; texto sintético indica que solo sirve en `tesis_test_db`, no es aviso jurídico, no autoriza uso con estudiantes reales y prohíbe ingresar datos reales. |
| `structured_signal_extraction` | `demo-4c3-signals-v1` | Misma etiqueta y restricciones, para extracción estructurada. |

El seeder inserta draft y lo publica dentro de la misma transacción solo tras la prevalidación. Si las dos versiones ya existen publicadas con contenido idéntico, la ejecución es idempotente. Nunca edita, supersede o borra avisos existentes. Los avisos publicados permanecen en `tesis_test_db` porque el trigger de inmutabilidad prohíbe borrarlos; no se intenta limpiar ni eliminar datos.

Las decisiones de consentimiento no se preinsertan. En cada corrida del test se crea una cuenta ficticia, se muestra el listado HTTP de avisos y se envían decisiones `granted` mediante `POST /api/v1/consents/me/decisions`. El test elimina esas cuentas sintéticas al finalizar; el borrado en cascada de sus eventos, sesiones, perfil y conversación ocurre solo en la base que ya pasó las guardas.

## Requisitos

- Node y dependencias instaladas (`npm install` solo si el checkout aún no las tiene).
- Una `TEST_DATABASE_URL` proporcionada de forma segura para un PostgreSQL **local** llamado exactamente `tesis_test_db`. No la imprimas ni la pongas en un commit.
- Esquema existente ya migrado para Authentication, Consent, Conversations y sus restricciones. Este procedimiento no migra ni crea tablas.
- Ningún aviso publicado conflictivo para las dos finalidades. Si hay uno distinto, el seed aborta; no lo modifica.

No configures `DATABASE_URL` como reemplazo. No es necesario ejecutar `npm run dev`: la prueba monta un servidor HTTP en loopback y puerto efímero, y lo cierra al terminar.

## Ejecución PowerShell

Configura `TEST_DATABASE_URL` en el entorno de la sesión usando el mecanismo local de secretos aprobado. No uses `Write-Output`, `echo` ni `Get-ChildItem Env:` para mostrar su valor. Si ya está disponible en el proceso, basta con comprobar presencia:

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) {
  throw 'Configura TEST_DATABASE_URL para una instancia local tesis_test_db antes de continuar.'
}
```

Carga los avisos sintéticos. El script aborta antes de cualquier escritura si falta la variable, la URL no apunta a loopback, el path no es `/tesis_test_db`, el servidor reporta otro nombre de base o detecta un aviso publicado distinto:

```powershell
npm run demo:seed-test-consent
```

Si informa `fixture_conflict`, ejecuta primero `npm run demo:diagnose-test-consent` y sigue la opción indicada en la tabla. No publiques, sustituyas ni borres avisos existentes para habilitar la demostración.

Ejecuta el flujo HTTP aislado completo:

```powershell
npm run demo:conversational
```

El test imprime solo un resumen sintético: autenticación completada, finalidades, cantidad de mensajes, número de observaciones, estado descriptivo, cantidad de campos faltantes, confirmación de no persistencia de resultado y que se usó proveedor simulado. No imprime tokens ni contenido de mensajes.

## Flujo comprobado por el harness

1. Lee avisos publicados y verifica que contengan las etiquetas de demo.
2. Registra una cuenta con correo `.example.test` y contraseña sintéticos; inicia sesión y recibe un JWT válido.
3. Acepta por HTTP ambas finalidades, con UUID de idempotencia distintos, y verifica el estado `granted`.
4. Crea una conversación y manda un mensaje ficticio por REST; un generador de chat simulado devuelve una respuesta sintética y el caso de uso existente persiste el turno bajo la autorización de procesamiento conversacional.
5. Lista mensajes y selecciona el mensaje `user` completado.
6. Llama explícitamente a `/signals/extract` y `/signals/results`; un extractor simulado devuelve una observación fija con referencias al mensaje seleccionado, datos faltantes y pregunta aclaratoria.
7. Comprueba propiedad: un segundo usuario no obtiene el resultado de la conversación ajena (`404`). Comprueba fail-closed: ese usuario sin consentimiento no puede solicitar resultado propio (`403`). En ambos casos no se llama al extractor.
8. Compara filas de mensajes y eventos de consentimiento antes/después de extracción y resultado. No se agrega ni modifica contenido conversacional ni se persiste un resultado; la API no tiene tabla de resultados.
9. El test cierra el servidor y elimina las cuentas sintéticas mediante sus FKs en `tesis_test_db`. Las versiones publicadas permanecen como fixtures inmutables.

No se prueba el SSE en este demo; REST basta para el flujo. REST/SSE del chat y análisis siguen siendo acciones distintas. No se habilita Safety ni se incorporan cuestionarios, puntuaciones o niveles clínicos.

## Cómo detener y estado posterior

Los comandos terminan al completar Vitest; el `finally` del test cierra HTTP y pool. Si el proceso se interrumpe manualmente, usa `Ctrl+C`. No ejecutes comandos de borrado ni intentes eliminar avisos publicados: son inmutables. Puedes volver a correr el seeder, que reusa únicamente sus versiones publicadas idénticas.

## Archivos y verificaciones

- `scripts/seed-test-consent-notices.ts`: seeder guardado por `TEST_DATABASE_URL`.
- `scripts/diagnose-test-consent-notices.ts`: inspección de estado de avisos solo lectura.
- `tests/integration/conversational-demo-notices.ts`: fixtures etiquetados, comparación compartida y publicación idempotente fail-closed.
- `tests/integration/conversational-demo.integration.test.ts`: harness HTTP, PostgreSQL, JWT y dobles.
- `package.json`: comandos `demo:diagnose-test-consent`, `demo:seed-test-consent` y `demo:conversational`.

No se ejecutaron los comandos demo porque `TEST_DATABASE_URL` estaba ausente. El typecheck, build y unitarias se reportan en la entrega del Sprint 4C.3. No se llamó a OpenAI ni se modificó `.env`, migraciones, `tesis_db` o bases productivas.
