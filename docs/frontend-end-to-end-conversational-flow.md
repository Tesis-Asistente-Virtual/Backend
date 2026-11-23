# Sprint 6A.2 — especificación frontend del flujo conversacional

**Estado:** especificación de implementación; no se creó una aplicación frontend.  
**Fuente de contratos:** schemas, controllers, routers y OpenAPI del backend inspeccionados en este sprint. Los ejemplos usan valores ficticios.

## Alcance y pantallas

1. **Registro / inicio de sesión:** formulario y estados de validación, rate limit y credenciales inválidas.
2. **Avisos y decisiones:** mostrar el texto vigente completo por finalidad y registrar solo la opción explícita que el usuario elija.
3. **Conversaciones:** listar, abrir y crear conversaciones propias; mostrar estados vacíos y paginación.
4. **Chat:** historial y composer con envío REST o SSE; distinguir generación, finalización, fallo y desconexión.
5. **Analizar conversación:** acción explícita sobre una selección de mensajes `completed`; estados de carga, consentimiento requerido, resultado vacío y errores.
6. **Resultado preliminar:** separar observaciones reportadas, brechas, preguntas opcionales, orientación fija y limitaciones. No mostrar inferencias como hechos clínicos.

El recorrido no incluye inscripción o sesiones longitudinales, asociación sesión-conversación, comparación entre periodos, puntuaciones DASS-21 ni Safety. El resultado es efímero: el frontend lo conserva solo mientras la vista está activa; recargar requiere una solicitud explícita nueva y vuelve a procesar los mensajes seleccionados.

## Contratos HTTP verificados

Todas las rutas privadas usan `Authorization: Bearer <accessToken>`. La cuenta se deriva del JWT; no enviar `accountId`. Los cuerpos Zod son estrictos y rechazan propiedades extra.

| Pantalla / acción | Método y ruta | Request | Respuesta documentada y errores relevantes | Consentimiento |
|---|---|---|---|---|
| Registro | `POST /api/v1/auth/sign-up` | `{ "email": string, "password": string }`; email válido hasta 320 caracteres, contraseña mínimo 12 | `201 { id, email, message }`; `400`, `409`, `500` | Ninguno para crear cuenta |
| Inicio de sesión | `POST /api/v1/auth/sign-in` | `{ "email": string, "password": string }` | `200 { accessToken, refreshToken, tokenType: "Bearer", expiresIn }`; `400`, `401`, `429`, `500` | Ninguno |
| Renovar sesión | `POST /api/v1/auth/refresh` | `{ "refreshToken": string }` | `200` mismo contrato de tokens; `400`, `401`, `429`, `500` | Ninguno |
| Cerrar sesión | `POST /api/v1/auth/sign-out` | `{ "refreshToken": string }` | `204`, sin cuerpo; `400`, `401`, `429`, `500` | Ninguno |
| Leer avisos vigentes | `GET /api/v1/consents/notices` | Sin body; pública | `200` arreglo de `{ id, purpose, version, content, effectiveAt }`; `500` | No concede autorización |
| Ver mi estado | `GET /api/v1/consents/me` | JWT | `200 { items: [{ purpose, state, currentNoticeVersion, changedAt }] }`; `401`, `500` | Informa por finalidad |
| Registrar decisión | `POST /api/v1/consents/me/decisions` | `{ purpose, noticeVersionId, action, idempotencyKey }` | `201 { id, purpose, noticeVersionId, action, createdAt }`; `400`, `401`, `404`, `409`, `500` | Decisión expresa, por aviso y finalidad |
| Crear conversación | `POST /api/v1/conversations` | `{ "title"?: string \| null }`, máximo 150 caracteres | `201 { id, title, status, createdAt, updatedAt }`; `400`, `401`, `500` | No inicia procesamiento del chat |
| Listar conversaciones propias | `GET /api/v1/conversations?limit=&offset=` | JWT; `limit` 1–100 (default 20), `offset` 0–1,000,000 (default 0) | `200 { items, pagination: { limit, offset, hasMore } }`; `400`, `401`, `500` | No requiere consentimiento para lectura de historial según el comportamiento actual |
| Abrir conversación propia | `GET /api/v1/conversations/{id}` | UUID en path y JWT | `200 { id, title, status, createdAt, updatedAt }`; `400`, `401`, `404`, `500` | No invoca proveedor |
| Consultar mensajes propios | `GET /api/v1/conversations/{id}/messages?limit=&offset=` | UUID de conversación y paginación | `200` página de `{ id, conversationId, role, content, status, createdAt }`; `400`, `401`, `404`, `500` | No invoca proveedor |
| Enviar mensaje REST | `POST /api/v1/conversations/{id}/messages` | `{ "content": string }`, trim no vacío, máximo 5,000 caracteres | `201 { userMessage, assistantMessage }`; `400`, `401`, `403`, `404`, `409`, `503`, `500` | `ai_conversation_processing` vigente |
| Enviar mensaje SSE | `POST /api/v1/conversations/{id}/messages/stream` | Mismo body que REST | `200 text/event-stream`; antes de headers puede responder `400`, `401`, `403`, `404`, `409`, `503`, `500` | `ai_conversation_processing` vigente y revalidado |
| Extracción explícita | `POST /api/v1/conversations/{id}/signals/extract` | `{ "messageIds": [UUID, ...] }`, 1–20 únicos | `200 { status, schemaVersion, observations, missingInformation, clarificationQuestions }`; `400`, `401`, `403`, `404`, `503` | `ai_conversation_processing` y `structured_signal_extraction` |
| Resultado preliminar | `POST /api/v1/conversations/{id}/signals/results` | Mismo body de extracción | `200` resultado descrito abajo; `400`, `401`, `403`, `404`, `503` | Ambos consentimientos anteriores |

Los avisos devueltos por GET son únicamente avisos publicados y efectivos. El frontend debe mostrar el `content` y no inferir consentimiento a partir de sesión, registro, casillas preseleccionadas ni de la mera presencia del aviso.

### Decisiones de consentimiento

Finalidades relevantes y no intercambiables:

- `ai_conversation_processing`: enviar mensajes a generación del asistente.
- `structured_signal_extraction`: extraer señales bajo solicitud explícita.
- `preliminary_assessment` y `longitudinal_monitoring` no autorizan ninguna de las dos operaciones anteriores.

Ejemplo de una decisión elegida expresamente por la persona:

```json
{
  "purpose": "ai_conversation_processing",
  "noticeVersionId": "550e8400-e29b-41d4-a716-446655440020",
  "action": "granted",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440021"
}
```

El cliente debe enviar una solicitud separada por cada finalidad y usar el `id` del aviso correspondiente a esa finalidad. `action` admite `granted`, `declined` o `withdrawn`. No precargar `granted`, no registrar consentimiento por la persona y no tratar una versión anterior como autorización de la vigente. Tras una retirada, actualizar estado mediante `GET /consents/me`, limpiar resultados en memoria y bloquear futuras solicitudes que dependan de esa finalidad. La retirada no implica que mensajes ya persistidos se borren automáticamente.

## Contrato de `preliminaryGuidance`

`POST /api/v1/conversations/{id}/signals/results` recibe el mismo request que `/signals/extract`, pero efectúa una extracción explícita y entrega también un resultado efímero. El schema de respuesta incluye:

Cada endpoint ejecuta su propia extracción. Si la pantalla necesita el resultado con `preliminaryGuidance`, debe llamar a `/signals/results` directamente; no llames inmediatamente antes a `/signals/extract` con la misma selección salvo que el producto necesite mostrar ambas respuestas, porque eso repetiría procesamiento.

```json
{
  "status": "completed",
  "id": "550e8400-e29b-41d4-a716-446655440099",
  "conversationId": "550e8400-e29b-41d4-a716-446655440001",
  "generatedAt": "2026-11-22T12:00:00.000Z",
  "schemaVersion": "1.0",
  "extractorVersion": "1.0.0",
  "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"],
  "observations": [],
  "missingInformation": [{ "field": "duration", "reason": "not_reported" }],
  "clarificationQuestions": ["¿Desde cuándo notas esta situación?"],
  "summary": {
    "descriptiveStatus": "no_observations",
    "reportedFacts": [],
    "emptyObservationsMeaning": "not_evidence_of_absence",
    "interpretationLimits": ["descriptive_only", "not_a_diagnosis", "clinical_severity_not_calculated", "not_a_safety_assessment"]
  },
  "preliminaryGuidance": {
    "contractVersion": "1.0",
    "conversationId": "550e8400-e29b-41d4-a716-446655440001",
    "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"],
    "observations": [],
    "informationGaps": [{ "field": "duration", "reason": "not_reported" }],
    "suggestedFollowUpQuestions": ["¿Desde cuándo notas esta situación?"],
    "generalGuidance": "Puedes revisar o corregir estas observaciones. Si algo importante no aparece, puedes compartirlo solo si así lo deseas.",
    "limitations": [
      "Este resumen se basa únicamente en los mensajes seleccionados.",
      "Las observaciones pueden no representar todo lo que quisiste expresar; puedes corregirlas.",
      "No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.",
      "No evalúa seguridad; una respuesta vacía o incompleta no demuestra ausencia de dificultades ni de riesgo."
    ]
  }
}
```

El ejemplo es ficticio y corresponde a la forma del schema OpenAPI; se omiten datos variables del extractor. En una respuesta real, los arrays de `observations`, `reportedFacts` y `preliminaryGuidance.observations` pueden contener evidencia reportada. La guía copia los valores reportados, no hace otra llamada al modelo. Cada observación guía conserva `sourceObservationIndex`, `field`, `text`, `sourceMessageIds` y, para `context`, `contextDomain`.

Presentación:

- **Observaciones:** “expresado en los mensajes seleccionados”, nunca “diagnóstico”, hecho clínico confirmado o nivel de severidad. Mantener navegación/atribución a esos mensajes.
- **Brechas:** información no disponible o insuficiente en el material procesado; no significa que esa experiencia no exista.
- **Preguntas:** sugerencias opcionales, no obligatorias.
- **Orientación y límites:** mostrar el texto fijo íntegro y de forma accesible. Está pendiente de revisión profesional; no es protocolo de atención.
- **Sin observaciones:** informar que no se generaron observaciones para los mensajes seleccionados; no decir que no existen dificultades ni riesgo.
- No mostrar `possibleDimensions` como categorías clínicas al usuario sin revisión profesional; no hay scores DASS-21, diagnóstico, predicción, severidad ni Safety en este resultado.

## Autenticación, propiedad y sesión en navegador

- Enviar access token como Bearer únicamente a rutas privadas; no incluirlo en URL, logs, analítica o errores visibles.
- El backend devuelve `accessToken` y `refreshToken` en JSON. No asumir que existe cookie `HttpOnly`; el contrato actual no la emite. Como recomendación frontend, mantener tokens fuera de `localStorage` y almacenamiento persistente. El almacenamiento en memoria implica que una recarga requiere autenticación o una decisión adicional sobre refresh; cualquier estrategia durable debe revisarse antes de implementarse.
- `POST /refresh` y `/sign-out` reciben el `refreshToken` en JSON. No registrar su contenido. Tras salir, borrar tokens y datos de la sesión en memoria.
- Ante `401`, detener solicitudes privadas y pedir autenticación. Ante `404` de conversación ajena/inexistente, no revelar ni inferir existencia de otra cuenta.
- No persistir `observations`, `preliminaryGuidance`, mensajes seleccionados ni respuestas del proveedor en localStorage, IndexedDB, session replay o analytics. Mantener el resultado solo en estado de memoria de la vista; limpiar al cerrar sesión, cambiar de cuenta, retirar consentimiento o abandonar la vista.
- Conversaciones/mensajes sí se persisten según los endpoints de chat. El resultado de señales no; no hay GET por su `id`.

## SSE: POST con `fetch`, no `EventSource`

La ruta es `POST /api/v1/conversations/{id}/messages/stream`, lleva JSON y Bearer token. La interfaz nativa `EventSource` no permite enviar este POST/body ni definir headers de autorización; usar `fetch`, `ReadableStream` y `AbortController`. Procesar el stream incrementalmente porque los chunks de red no necesariamente coinciden con frames SSE; separar frames por línea vacía y manejar fragmentos UTF-8 parciales.

Eventos y datos actuales:

| Evento SSE | `data` JSON | Acción UI |
|---|---|---|
| `message.started` | `{ "messageId": UUID }` | Mostrar que el turno inició; el mensaje del usuario ya se escribió en DB. |
| `message.delta` | `{ "text": string }` | Añadir fragmentos de forma progresiva, marcando el mensaje como provisional. |
| `message.completed` | `{ "messageId": UUID, "status": "completed" }` | El mensaje final del asistente fue persistido; confirmar estado completado. |
| `stream.completed` | `{}` | Cerrar indicador de generación; el turno terminó. |
| `stream.error` | `{ "code": "generation_failed" \| "persistence_failed" \| "consent_required" \| "consent_unavailable" }` | Marcar turno fallido y usar mensaje genérico. Si la conexión falla después de headers, el controller puede enviar `internal_error`. |

Inicio esquemático compatible con navegador:

```ts
const controller = new AbortController();
const response = await fetch(`${baseUrl}/api/v1/conversations/${conversationId}/messages/stream`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    accept: 'text/event-stream',
  },
  body: JSON.stringify({ content: draft }),
  signal: controller.signal,
});

if (!response.ok) {
  // Antes de iniciar el stream, procesar respuesta HTTP de error.
  throw new Error(`Request failed: ${response.status}`);
}
if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
  throw new Error('Expected an SSE response body');
}
// Leer response.body.getReader(), decodificar UTF-8 en modo streaming,
// acumular texto parcial, dividir en frames SSE y despachar por `event:`.
// Llamar controller.abort() si el usuario cancela.
```

El código es el armazón de transporte, no un parser completo; la implementación React debe añadir el parser SSE probado y liberar reader/listeners en todos los caminos. Ante cancelación/desconexión, el backend aborta generación. El mensaje de usuario pudo quedar persistido y, si falla/cancela luego de iniciar, puede existir un mensaje de asistente `failed` sin contenido. No reintentar automáticamente: el POST no ofrece idempotencia ni reanudación del stream. Al reconectar, consultar mensajes propios para reconciliar estado antes de ofrecer nuevo envío.

Los errores de autorización/propiedad/estado anteriores a `flushHeaders()` se reciben como respuestas HTTP normales. Después de iniciar SSE no se puede cambiar el status; se comunica mediante `stream.error` o cierre de conexión. Si `stream.error.code` es `consent_required` o `consent_unavailable`, bloquear nuevos turnos y actualizar consentimiento; no continuar con el buffer existente como si el turno estuviera completado.

## Estados de UI y errores

- **Auth:** submitting, authenticated, invalid credentials (`401`), validation (`400`), rate limited (`429`), unavailable (`500`).
- **Consent:** loading, needs decision, granted, declined, withdrawn, renewal required. Un aviso ausente o sin versión vigente bloquea acciones dependientes; no crear un consentimiento de demo desde el frontend.
- **Conversation:** loading, empty, active, archived, page loading, network error. Paginación `limit`/`offset` proviene del contrato.
- **Chat:** idle, sending, streaming, completed, failed, cancelled, reconciling. Deshabilitar doble envío mientras hay turno activo; no convertir fallo de transporte incierto en reintento ciego.
- **Analysis:** idle, selecting, submitting, completed, no observations, consent required, not found, unavailable. Botón explícito; 1–20 IDs UUID únicos de mensajes `completed` de la conversación actual.
- **HTTP:** `400` corregir entrada; `401` reautenticar; `403` revisar estado de consentimiento; `404` no revelar recursos ajenos; `409` resolver conflicto consultando mensajes/estado; `429` esperar; `503` indicar indisponibilidad y permitir reintento explícito luego de confirmar estado. No renderizar cuerpo técnico arbitrario como HTML.
- **Resultado:** error o cancelación limpia el estado de loading; mantener el resultado previo solo mientras siga en la misma vista/cuenta y el producto decida mantenerlo visible, pero no usarlo para iniciar otro flujo ni recuperarlo por ID.

## Accesibilidad

- Todos los controles deben tener nombre accesible, label persistente y foco visible; navegación completa por teclado y orden de foco lógico.
- Anunciar estados no intrusivos (`role="status"`/live region) al iniciar, completar o fallar el stream. No anunciar cada token delta como mensaje independiente; agrupar actualizaciones para evitar saturación del lector.
- Mensajes de consentimiento y errores deben ser texto claro, asociados a controles; no depender solo de color/icono. Ofrecer revisión y rechazo con igual claridad a la aceptación.
- Mantener contraste de texto y foco conforme a WCAG que adopte el proyecto; permitir zoom/reflow, respetar preferencias de movimiento y no animar indefinidamente el indicador de carga.
- En streaming, preservar el foco y anunciar el resultado completo al terminar; ofrecer un control explícito para detener la generación.
- Evitar copy estigmatizante, alarmista o con afirmaciones clínicas; la redacción fija aún requiere revisión profesional, ética y jurídica antes de tratar participantes.

## Modos de ejecución y límites

- **Demo integrada 6A.1 reportada como aprobada por el proyecto:** `npm run demo:conversational` valida `DEMO_DATABASE_URL` contra loopback y `tesis_demo_db`, usa PostgreSQL con cuenta, JWT y consentimiento sintéticos/reales dentro de esa base y generadores simulados. No representa una conexión de un frontend desplegado ni llama a OpenAI.
- **Servidor normal:** la composición HTTP usa adaptadores configurados; mensajes REST/SSE y extracción/resultados pueden llamar al proveedor real. El harness de demo no agrega un endpoint de mock ni cambia el servidor productivo. No usar mensajes sensibles reales en una prueba manual.
- `preliminaryGuidance` tiene textos fijos pendientes de revisión profesional. El backend no diagnostica ni calcula DASS-21 en estos endpoints.
- Safety está inactivo. LongitudinalMonitoring, asociación sesión-conversación, declaraciones y comparación entre periodos no son parte del recorrido.
- No se certifica aptitud para piloto con estudiantes ni validación clínica, jurídica o ética.

## Bloqueos y siguiente incremento

Antes de implementar UI productiva: obtener revisión profesional/ética/jurídica de avisos y textos; definir estrategia de refresh token compatible con el navegador sin persistencia insegura; probar parser SSE/cancelación bajo los navegadores objetivo; y acordar UX de retiro de consentimiento y limpieza de memoria. Luego implementar un vertical slice frontend limitado a Auth/Consent/Conversations/resultado efímero, con cliente tipado desde OpenAPI y pruebas accesibles; mantener el resultado solo en memoria y no enlazar LongitudinalMonitoring.
