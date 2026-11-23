# Contrato de integración Backend–Frontend

**Versión del OpenAPI:** 1.0.0 (OpenAPI 3.0.3).  
**Base URL publicada por OpenAPI:** `http://localhost:3000` (solo servidor local; cambiarla por la base de despliegue aprobada).  
**Alcance:** contratos existentes de Auth/Users, Consent, Conversations REST/SSE y extracción/resultados. No describe funciones longitudinales, scoring DASS-21 ni Safety como disponibles.

## Autenticación

Las rutas privadas requieren `Authorization: Bearer <accessToken>`. La API obtiene `accountId` de los claims JWT; no se envía en body ni query. Sin token, formato inválido, JWT expirado o sujeto inválido: `401 { "error": "Unauthorized" }`.

### Rutas Auth

| Método / ruta | Body estricto | Éxito | Errores documentados |
|---|---|---|---|
| `POST /api/v1/auth/sign-up` | `{ email, password }`; email válido máx. 320 chars; password mínimo 12 chars | `201 { id, email, message }` | `400`, `409` email registrado, `500` |
| `POST /api/v1/auth/sign-in` | `{ email, password }`; email válido máx. 320 chars; password no vacío | `200 { accessToken, refreshToken, tokenType: "Bearer", expiresIn }` | `400`, `401`, `429`, `500` |
| `POST /api/v1/auth/refresh` | `{ refreshToken }`; string de 1–512 chars | `200` mismo DTO de tokens; el refresh token anterior rota | `400`, `401`, `429`, `500` |
| `POST /api/v1/auth/sign-out` | `{ refreshToken }`; string de 1–512 chars | `204`, sin body | `400`, `401`, `429`, `500` |

Tokens se devuelven en JSON; el backend no establece cookie `HttpOnly`. El contrato actual no define persistencia segura del refresh token en navegador. No guardarlo en `localStorage` por conveniencia; acordar con el equipo una estrategia antes de implementar sesión durable. Sign-in y endpoints de sesión tienen rate limit por proceso.

### Perfil propio

| Método / ruta | Body | Éxito | Errores |
|---|---|---|---|
| `GET /api/v1/users/me` | Sin body, JWT | `200 { firstName, lastName, phone }`; cada campo puede ser `null` | `401`, `404`, `500` |
| `PATCH /api/v1/users/me` | Uno o más de `{ firstName?, lastName?, phone? }`; cada nombre `string \| null` (trim, 1–100); teléfono `string \| null` (7–30, caracteres telefónicos permitidos). No acepta campos extra | `200 { firstName, lastName, phone }` | `400`, `401`, `404`, `500` |

## Consent & Privacy

### Avisos y estado

- `GET /api/v1/consents/notices` es público y devuelve un arreglo de avisos publicados efectivos: `{ id, purpose, version, content, effectiveAt }`. `200`; `500` si falla la consulta. Leer un aviso **no** registra una decisión.
- `GET /api/v1/consents/me` requiere JWT y responde `200 { items: [{ purpose, state, currentNoticeVersion, changedAt }] }`; `401`, `500`.
- `state` puede ser `granted`, `declined`, `withdrawn`, `not_decided` o `renewal_required`. `currentNoticeVersion` y `changedAt` pueden ser `null`.

Finalidades válidas actuales: `ai_conversation_processing`, `structured_signal_extraction`, `preliminary_assessment`, `longitudinal_monitoring`. No son intercambiables.

### Registrar decisión expresa

`POST /api/v1/consents/me/decisions` requiere JWT y body estricto:

```json
{
  "purpose": "ai_conversation_processing",
  "noticeVersionId": "550e8400-e29b-41d4-a716-446655440020",
  "action": "granted",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440021"
}
```

Todos los IDs son UUID. `action`: `granted`, `declined` o `withdrawn`. Éxito `201 { id, purpose, noticeVersionId, action, createdAt }`. Errores `400`, `401`, `404` aviso no disponible/vigente, `409` clave idempotente repetida con otro payload, `500`. Usar el `id` del aviso vigente de esa finalidad; pedir una decisión separada para cada una y nunca precargar aceptación.

### Finalidades requeridas por operación

| Operación | Consentimiento vigente requerido |
|---|---|
| Crear/listar/consultar historial de conversación | No se exige consentimiento de procesamiento para crear o leer. Lecturas permanecen disponibles al propietario tras retirar consentimiento. |
| Enviar mensaje por REST o SSE y transferir contexto a generación | `ai_conversation_processing` |
| `signals/extract` y `signals/results` | `ai_conversation_processing` **y** `structured_signal_extraction` |

Retiro o falta de autorización bloquea nuevo procesamiento correspondiente. No borra automáticamente mensajes ya guardados ni revierte una transferencia ya iniciada al proveedor. Si un aviso queda sustituido, se requiere decisión compatible con el aviso vigente. La UI debe actualizar `/consents/me`, detener acciones afectadas y no tratar un JWT como consentimiento.

## Conversations REST

Todas estas rutas requieren Bearer JWT y operan solo sobre recursos propios. Conversación ajena o inexistente se devuelve como `404` para no revelar existencia.

| Método / ruta | Request | Éxito | Errores |
|---|---|---|---|
| `POST /api/v1/conversations` | `{ title?: string \| null }`; máximo 150 chars; propiedades extra rechazadas | `201 { id, title, status, createdAt, updatedAt }` | `400`, `401`, `500` |
| `GET /api/v1/conversations?limit=&offset=` | `limit` 1–100 (default 20); `offset` 0–1,000,000 (default 0) | `200 { items: Conversation[], pagination: { limit, offset, hasMore } }` | `400`, `401`, `500` |
| `GET /api/v1/conversations/{id}` | `{id}` UUID | `200 { id, title, status, createdAt, updatedAt }` | `400`, `401`, `404`, `500` |
| `GET /api/v1/conversations/{id}/messages?limit=&offset=` | UUID y misma paginación | `200 { items: Message[], pagination: { limit, offset, hasMore } }` | `400`, `401`, `404`, `500` |
| `POST /api/v1/conversations/{id}/messages` | `{ "content": string }`; trim no vacío, máximo 5,000 chars; strict | `201 { userMessage, assistantMessage }` | `400`, `401`, `403`, `404`, `409`, `503`, `500` |

`Conversation` es `{ id, title, status: "active" | "archived", createdAt, updatedAt }`. `Message` es `{ id, conversationId, role: "user" | "assistant", content, status: "generating" | "completed" | "failed", createdAt }`. El envío REST persiste el mensaje del usuario y la respuesta completa; requiere `ai_conversation_processing`. `403` indica consentimiento requerido; `409` conflicto de turno o conversación archivada; `503` generador/consentimiento no disponible.

## SSE por POST

Ruta: `POST /api/v1/conversations/{id}/messages/stream`, body idéntico al envío REST, JWT Bearer, respuesta `200 text/event-stream`. Es un **POST con JSON**; `EventSource` nativo no permite este método/body ni configurar Authorization Bearer. En navegador se consume con `fetch`, `ReadableStream` y cancelación con `AbortController`.

Eventos runtime:

| `event` | `data` |
|---|---|
| `message.started` | `{ "messageId": UUID }` |
| `message.delta` | `{ "text": string }` |
| `message.completed` | `{ "messageId": UUID, "status": "completed" }` |
| `stream.completed` | `{}` |
| `stream.error` | `{ "code": "generation_failed" | "persistence_failed" | "consent_required" | "consent_unavailable" | "internal_error" }` |

Los frames son `event: <name>\ndata: <JSON>\n\n`. HTTP `400/401/403/404/409/503/500` aplica antes de enviar headers SSE; después de `flushHeaders` no puede cambiarse el status, y un error se comunica como `stream.error` cuando la conexión sigue abierta. `message.started` ocurre después de persistir el mensaje del usuario; al completar generación se persiste la respuesta del asistente. Cancelación/fallo intenta dejar un mensaje de asistente `failed` con contenido vacío. No hay idempotencia ni reanudación: no repetir automáticamente un POST ante desconexión incierta; reconciliar consultando mensajes.

El streaming mostrado puede contener texto incremental antes de tener respuesta final persistida. El cliente debe tratarlo como provisional hasta `message.completed` y `stream.completed`; en `stream.error` o desconexión no asumir éxito. No persistir fragmentos localmente como historial definitivo.

## Extracción explícita y resultado preliminar

### Solicitud

Ambas rutas requieren JWT, propiedad de conversación y de mensajes, mensajes `completed`, UUID únicos (1–20) y dos consentimientos vigentes separados. `accountId` no se acepta.

```http
POST /api/v1/conversations/550e8400-e29b-41d4-a716-446655440001/signals/results
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "messageIds": ["550e8400-e29b-41d4-a716-446655440010"]
}
```

`POST /api/v1/conversations/{id}/signals/extract` devuelve `200 { status: "completed", schemaVersion: "1.0", observations, missingInformation, clarificationQuestions }`.

`POST /api/v1/conversations/{id}/signals/results` vuelve a ejecutar la extracción y devuelve directamente el resultado efímero con campos públicos exactos:

```text
status, id, conversationId, generatedAt, schemaVersion, extractorVersion,
sourceMessageIds, observations, missingInformation, clarificationQuestions,
summary, preliminaryGuidance
```

No incluye `accountId`, DASS-21 scores ni diagnóstico. `preliminaryGuidance` (`contractVersion: "1.0"`) contiene `conversationId`, `sourceMessageIds`, `observations`, `informationGaps`, `suggestedFollowUpQuestions`, `generalGuidance` y `limitations`. Cada guía-observación incluye `sourceObservationIndex`, `field`, `text`, `sourceMessageIds` y opcionalmente `contextDomain`. Solo se mapean datos que el extractor marcó como `reported`; el mapeo no es una revisión semántica profesional. Brechas `not_reported`, `ambiguous`, `not_assessed` no significan ausencia de dificultades. `summary.emptyObservationsMeaning` es `not_evidence_of_absence`.

El `200` completo con UUID y texto ficticios está en Swagger (`/api-docs`, JSON en `/api-docs.json`). La respuesta tiene también observaciones de extracción, `summary.reportedFacts`, versiones e interpretación-límites; consumir el schema completo en lugar de reducir el contrato a este resumen. Los límites declaran que es descriptivo, no diagnóstico, no calcula severidad clínica y no es evaluación de seguridad.

Status de error: `400` path/body/UUID/referencias inválidos; `401` token ausente/inválido; `403` falta/retirada de una de las finalidades; `404` conversación ajena/inexistente; `503` checker o extractor no disponible/cancelado. Body JSON genérico: `{ "error": string }`. Ningún resultado se guarda ni se consulta luego por `id`; cada llamada a `/signals/extract` o `/signals/results` hace una extracción independiente. Si solo se necesita el resultado para frontend, llamar directamente a `/signals/results` para no duplicar procesamiento.

## OpenAPI, compatibilidad y hallazgos

- OpenAPI se sirve en `/api-docs` (UI) y `/api-docs.json` (documento); Bearer scheme `bearerAuth` representa JWT. Los ejemplos de resultado son sintéticos.
- Se corrigió la especificación OpenAPI de SSE: antes no enumeraba todos los códigos `stream.error` emitidos por el controller (`persistence_failed`, `consent_unavailable`, y fallback `internal_error`). Ahora los ejemplos los reflejan y un test evita regresión.
- Se corrigió el mapeo de JSON mal formado: `express.json()` producía error de parseo que el handler genérico devolvía como `500`; ahora responde `400 { "error": "Invalid JSON body" }`. Zod request inválido sigue devolviendo `400 { "error": "Invalid request data" }`.
- Los contratos `/signals/results`, `preliminaryGuidance`, consentimiento y propiedad coincidían con controller/schema; no se cambió su comportamiento.
- **Bloqueo de navegador cross-origin:** `src/app.ts` no registra middleware CORS ni responde preflight `OPTIONS`; además OpenAPI define servidor `localhost:3000`. Una app de otro origen que envíe `Authorization` y `application/json` necesita preflight y el navegador bloqueará la llamada. No se habilitó CORS permisivo: el origen exacto permitido del frontend y URL del backend desplegado deben acordarse y añadirse a la configuración permitida antes de integración browser-to-API. Un proxy same-origin puede evitar CORS si el equipo de despliegue lo decide.

### CORS configurable (Sprint 6B.2)

La aplicación permite cross-origin únicamente para orígenes enumerados explícitamente en `CORS_ALLOWED_ORIGINS`. Si la variable no está definida o está vacía, no emite `Access-Control-Allow-Origin` y el browser no puede leer respuestas cross-origin. No hay origen localhost concedido implícitamente.

Formato: lista separada por comas, cada elemento debe ser un origen HTTP(S) canónico sin path, query, fragmento, credenciales ni wildcard. Orígenes vacíos, duplicados, comodines o no canónicos hacen fallar la configuración al iniciar; no se ignoran silenciosamente.

Ejemplos para configurar el proceso (no modificar `.env` automáticamente):

```powershell
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173'
# Alternativa con dos orígenes elegidos por despliegue:
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173,https://frontend.example.edu.pe'
npm run dev
```

`frontend.example.edu.pe` es un ejemplo documental y no queda autorizado hasta añadirse deliberadamente a la configuración de ese entorno. Usar exactamente el scheme, host y puerto que presenta el navegador.

Preflight autorizado `OPTIONS` devuelve `204`, `Access-Control-Allow-Origin` con el origen coincidente, `Vary: Origin`, métodos `GET, HEAD, POST, PATCH, OPTIONS` y headers `Authorization, Content-Type`. Método/header solicitado no permitido o preflight de origen no listado devuelve `403` sin cabeceras CORS permisivas. Solicitudes no preflight de un origen no listado siguen al router sin `Access-Control-Allow-Origin`; el browser impide que código de ese origen lea la respuesta. No se emite `Access-Control-Allow-Credentials` ni se usa `*`.

Verificación manual con el backend local y la variable configurada para el proceso:

```powershell
curl.exe -i -X OPTIONS 'http://localhost:3000/api/v1/conversations/550e8400-e29b-41d4-a716-446655440001/messages/stream' `
  -H 'Origin: http://localhost:5173' `
  -H 'Access-Control-Request-Method: POST' `
  -H 'Access-Control-Request-Headers: authorization,content-type'

# Debe responder 403 sin Access-Control-Allow-Origin para un origen no listado.
curl.exe -i -X OPTIONS 'http://localhost:3000/api/v1/conversations/550e8400-e29b-41d4-a716-446655440001/messages/stream' `
  -H 'Origin: https://unlisted.example' `
  -H 'Access-Control-Request-Method: POST' `
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

CORS solo permite que el navegador exponga respuestas a JavaScript del origen autorizado. No autentica, no valida ownership, no sustituye JWT ni consentimiento. El deployment debe además configurar OpenAPI/base URL y TLS adecuados al entorno. El middleware tampoco habilita cookies: el contrato de auth continúa devolviendo tokens en JSON.

## Limitaciones y funciones no habilitadas

- El modo normal usa los adaptadores de proveedor configurados; enviar mensajes o invocar extracción/resultados puede contactar al proveedor real. La demo 6A.1 reportada por el equipo utiliza generadores falsos en un harness separado; no es un modo mock de la API normal.
- Mensajes de conversación sí se persisten. Resultados de extracción/preliminaryGuidance son efímeros y solo los mantiene el cliente durante la vista actual.
- No activar/mostrar DASS-21 scores, diagnósticos, categorías clínicas, Safety ni derivaciones.
- LongitudinalMonitoring y la asociación sesión-conversación no forman parte de este contrato frontend; el uso real está bloqueado. No asumir endpoints de declaración, consulta histórica o comparación longitudinal.
- El texto fijo de orientación requiere revisión profesional, ética y jurídica; esta especificación no certifica validación clínica ni aptitud para piloto.
