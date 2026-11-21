# Sprint 4C.2 — Validación manual controlada

## Resultado

**La demo de extremo a extremo no pudo ejecutarse en este ambiente.** La inspección confirmó que la guía usa rutas y campos presentes en los routers, controllers, schemas Zod y OpenAPI actuales. Sin embargo, no había servidor respondiendo en `http://localhost:3000`; los GET de solo lectura a `/health` y `/api/v1/consents/notices` no estuvieron disponibles. `TEST_DATABASE_URL` tampoco estaba configurada. No fue posible determinar si hay avisos publicados: su estado queda **desconocido**, no se afirma que falten.

No se ejecutó ningún POST, no se creó cuenta ni decisión, no se consultó ni modificó PostgreSQL directamente, no se ejecutaron pruebas de integración, y no se llamó a OpenAI. Tampoco se modificaron `.env`, avisos, migraciones o datos.

## Contratos revisados

| Paso | Ruta | Contrato confirmado |
| --- | --- | --- |
| Registro | `POST /api/v1/auth/sign-up` | Body estricto `{ email, password }`; password mínimo 12; respuesta `201` `{ id, email, message }`. |
| Inicio de sesión | `POST /api/v1/auth/sign-in` | Body `{ email, password }`; respuesta `200` con `accessToken`, `refreshToken`, `tokenType`, `expiresIn`. |
| Avisos vigentes | `GET /api/v1/consents/notices` | Público; arreglo con `id`, `purpose`, `version`, `content`, `effectiveAt`. Solo avisos publicados y efectivos. |
| Estado propio | `GET /api/v1/consents/me` | Bearer JWT; respuesta `{ items: [...] }`; estado incluye `granted`, `declined`, `withdrawn`, `not_decided` o `renewal_required`. |
| Decisión | `POST /api/v1/consents/me/decisions` | JWT; body estricto `{ purpose, noticeVersionId, action, idempotencyKey }`; respuesta `201` con evento registrado. |
| Crear conversación | `POST /api/v1/conversations` | JWT; body `{ title? }`; respuesta `201` con ID y estado. |
| Enviar mensaje | `POST /api/v1/conversations/:id/messages` | JWT y consentimiento de procesamiento conversacional; body `{ content }`; respuesta `201` con `userMessage` y `assistantMessage`. Puede invocar OpenAI si está configurado. |
| Streaming | `POST /api/v1/conversations/:id/messages/stream` | JWT; body `{ content }`; SSE. Es una variante, no se debe repetir para el mismo turno salvo que se desee enviar otro mensaje. |
| Listar mensajes | `GET /api/v1/conversations/:id/messages?limit=20&offset=0` | JWT; respuesta paginada `{ items, pagination }`; seleccionar solo mensajes `completed`. |
| Extracción | `POST /api/v1/conversations/:id/signals/extract` | JWT; requiere consentimientos vigentes `ai_conversation_processing` y `structured_signal_extraction`; body `{ messageIds }`, entre 1 y 20 UUID únicos; salida `{ status, schemaVersion, observations, missingInformation, clarificationQuestions }`. |
| Resultado | `POST /api/v1/conversations/:id/signals/results` | Mismo JWT, autorización y body; responde con DTO descriptivo efímero, sin `accountId` y sin persistir. Cada llamada vuelve a ejecutar extracción; no existe GET por ID. |

Los controles de propiedad se derivan del JWT. Conversación ajena o inexistente responde `404`; falta/retiro de consentimiento responde `403`; JWT ausente o inválido responde `401`. La ruta `/extract` y `/results` no cambia la conversación ni escribe resultados.

## Estado de consentimiento y bloqueos

- El listado de avisos no pudo consultarse porque el servidor local no estaba disponible. No se conoce el número ni la versión de avisos por finalidad.
- Antes de una demo manual debe comprobarse que hay avisos publicados y efectivos para **ambas** finalidades. Se debe mostrar el contenido real y dejar que la persona registre su decisión expresa. No se crean avisos ficticios.
- Si falta un aviso o no hay un `granted` vigente vinculado a la versión vigente, extracción y resultado deben detenerse con `403`; no existe bypass de desarrollo.
- Los comandos manuales para registrar consentimiento, crear conversación o enviar mensajes escriben en la base configurada por la instancia. Solo deben ejecutarse después de confirmar que esa instancia usa una base local aislada para demo, nunca `tesis_db` ni producción.
- Las pruebas de integración tienen un helper que puede crear avisos con texto identificado como fixture no legal y datos sintéticos exclusivamente en `tesis_test_db`. Son fixtures técnicos y no autorizan tratamiento de personas.

## Modo simulado y modo con proveedor

**Modo simulado:** la integración HTTP+PostgreSQL monta los routers, JWT, repositorios Drizzle y Consent real, pero inyecta un `ConversationSignalExtractor` simulado. No se comunica con OpenAI. Se ejecuta solo después de configurar `TEST_DATABASE_URL` para la instancia local `tesis_test_db`; las guardas de `tests/integration/test-database.ts` verifican nombre de base y host. No existe una API HTTP que cambie dinámicamente a mock.

**Modo manual con proveedor:** el servidor compone `OpenAiTextGenerator` y `OpenAiConversationSignalExtractor` a partir de su configuración. Enviar mensaje, invocar `/extract` o invocar `/results` puede generar llamadas reales al proveedor. La generación del resultado vuelve a ejecutar extracción y, por tanto, puede implicar otra solicitud. Ninguna llamada de este tipo se realizó durante esta validación.

## Pasos para reintentar la demo

1. Configura y arranca una instancia local apuntando a una base aislada de demo; no uses `tesis_db` ni producción. El proyecto define `npm run dev` y el puerto por defecto es 3000.
2. Comprueba `GET /health` y `GET /api/v1/consents/notices`. Si el segundo endpoint devuelve `[]` o falta una finalidad, detén la demo; no siembres avisos productivos.
3. Ejecuta registro e inicio con un correo sintético. Presenta cada aviso vigente y registra únicamente la decisión voluntaria con su `noticeVersionId` exacto y un UUID de idempotencia.
4. Verifica ambos estados como `granted` con `GET /api/v1/consents/me`.
5. Crea una conversación, envía un mensaje sintético y consulta mensajes. Para evitar proveedor real, usa la integración simulada; la app manual no ofrece un adaptador HTTP mock.
6. Selecciona `messageIds` de mensajes `completed`, solicita `/signals/extract` y luego `/signals/results`. La segunda llamada vuelve a ejecutar el extractor y su resultado solo vive en la respuesta.

Para el modo automatizado, primero configura `TEST_DATABASE_URL` en la sesión de ejecución con una URL local verificada cuyo path sea `/tesis_test_db`; nunca uses `DATABASE_URL` como fallback. Esta tarea no ejecutó integración porque la variable estaba ausente.

## Ejecución y verificación

Durante esta tarea se ejecutaron:

- `GET http://localhost:3000/health`: servidor no disponible.
- `GET http://localhost:3000/api/v1/consents/notices`: endpoint no disponible.
- Comprobación de presencia de `TEST_DATABASE_URL`: ausente; no se intentó conexión PostgreSQL.

Se inspeccionaron los schemas y rutas reales del repositorio. No se hicieron llamadas a endpoints de escritura, OpenAI ni bases de datos.

## Limitaciones

- El estado actual de avisos publicados sigue sin verificarse.
- La demo manual no es segura hasta confirmar la base de datos local aislada y la disponibilidad de avisos aprobados para ambas finalidades.
- La integración con extractor simulado no pudo repetirse sin `TEST_DATABASE_URL`.
- La ruta `/results` no conserva el resultado; el frontend debe consumirlo en la respuesta actual.
- La extracción es descriptiva, no clínica; no activa Safety ni genera puntuación o severidad.
