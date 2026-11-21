# ConversationalProcessing

Este bounded context extrae observaciones tentativas de mensajes explícitamente seleccionados. No diagnostica, no calcula severidad, no decide seguridad y no persiste observaciones.

## Solicitud HTTP explícita

`POST /api/v1/conversations/:id/signals/extract` requiere Bearer JWT y body estricto:

```json
{
  "messageIds": ["550e8400-e29b-41d4-a716-446655440010"]
}
```

Se admiten entre 1 y 20 IDs UUID únicos. `accountId` no se recibe del cliente: se toma de `req.auth.accountId`. El caso de uso existente verifica que la conversación pertenece a esa cuenta y que cada referencia corresponde a un mensaje completado de esa conversación; los mensajes se envían en orden cronológico. El adaptador limita el tamaño contextual conforme a la configuración ya existente.

Se requieren por separado los consentimientos vigentes `ai_conversation_processing` y `structured_signal_extraction`. Ambos se comprueban antes de recuperar/usar el contenido y se vuelven a comprobar inmediatamente antes de invocar el extractor. Un error del autorizador falla cerrado. La extracción es bajo demanda del frontend, nunca se inicia desde envío REST/SSE del chat.

La respuesta de extracción 200 mantiene el contrato estructurado versionado `1.0` y `status: "completed"`. Incluye observaciones tentativas, referencias a mensajes, información faltante y preguntas de aclaración. Una lista vacía de observaciones puede ser una extracción válida. Los errores técnicos no se transforman en una salida vacía.

## Resultado descriptivo efímero

`POST /api/v1/conversations/:id/signals/results` solicita explícitamente la misma extracción autorizada y devuelve un resultado descriptivo versionado directamente en esa respuesta. Conserva los campos de observación, agrega un ID efímero, fecha de generación, versión del extractor (`1.0.0`), referencias fuente y un resumen determinista construido solo con evidencia `reported`. El `accountId` se usa para propiedad interna y no se devuelve al cliente.

El resumen separa hechos reportados, información faltante y preguntas pendientes. `no_observations` significa solamente que no se generaron observaciones para los mensajes seleccionados; nunca significa ausencia de síntomas ni de riesgo. El resultado incluye límites explícitos: descriptivo, no diagnóstico, sin cálculo de severidad clínica y sin evaluación de seguridad.

No hay persistencia ni caché en memoria, y por eso no existe un endpoint GET por ID. El frontend recibe el resultado completo para presentarlo inmediatamente; el ID solo identifica esa respuesta transitoria. El endpoint existente `/signals/extract` conserva su contrato sin los nuevos campos.

Ambos endpoints no guardan mensajes ni resultados y no alteran la conversación. El adaptador usa Responses API, `store:false`, `tools:[]`, validación Zod y errores tipados. La revalidación reduce la ventana de retiro, pero no puede revocar información que ya haya sido transferida al proveedor durante una solicitud iniciada. Persistencia y consulta posterior quedan bloqueadas hasta que se apruebe una política de retención, retiro y supresión.

## Límites

La salida no es evaluación psicométrica, puntuación DASS, nivel de severidad, diagnóstico ni evaluación de seguridad. No existe integración con Safety. La aprobación de finalidades, avisos, proveedor, retención y uso con estudiantes requiere revisión profesional, jurídica y ética independiente.
