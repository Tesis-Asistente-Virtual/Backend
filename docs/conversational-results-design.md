# Resultados conversacionales descriptivos

## Diseño y estado

Los resultados se generan solo cuando el cliente realiza una solicitud explícita. Se reutiliza `ExtractAuthorizedConversationSignals` y el extractor existente; no se añade una llamada adicional a OpenAI. La síntesis es una transformación determinista de la salida Zod validada.

**Estado de persistencia: desactivada.** El repositorio no contiene una política aprobada para retención, acceso histórico tras retirar consentimiento, supresión o exportación de resultados conversacionales. No se crea tabla, caché en memoria ni recurso GET con almacenamiento temporal implícito. El endpoint entrega el resultado directamente; su ID es efímero y no permite recuperarlo en una llamada posterior. El frontend puede presentarlo durante la interacción actual. Consulta posterior en el servidor queda pendiente de una política aprobada.

## Contratos

El endpoint previo permanece sin cambios:

`POST /api/v1/conversations/:id/signals/extract`

Su respuesta sigue siendo `{ status, schemaVersion, observations, missingInformation, clarificationQuestions }`.

Nuevo endpoint:

`POST /api/v1/conversations/:id/signals/results`

Usa el mismo body estricto (`messageIds`, entre 1 y 20 UUID únicos) y los mismos controles de JWT, propietario, mensajes completados y doble consentimiento. Responde HTTP 200 con el DTO definido por `generateConversationSignalResultResponseSchema`:

```json
{
  "status": "completed",
  "id": "550e8400-e29b-41d4-a716-446655440099",
  "conversationId": "550e8400-e29b-41d4-a716-446655440001",
  "generatedAt": "2026-11-21T12:00:00.000Z",
  "schemaVersion": "1.0",
  "extractorVersion": "1.0.0",
  "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"],
  "observations": [
    {
      "evidence": "reported",
      "manifestation": { "status": "reported", "value": "Cansancio durante una semana ficticia de exámenes." },
      "possibleDimensions": ["stress"],
      "duration": { "status": "not_reported" },
      "frequency": { "status": "not_assessed" },
      "intensity": { "status": "not_assessed" },
      "contexts": [
        { "domain": "academic", "evidence": { "status": "reported", "value": "Semana de exámenes sintética." } }
      ],
      "functionalImpact": { "status": "not_assessed" },
      "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"]
    }
  ],
  "missingInformation": [
    { "field": "duration", "reason": "not_reported" },
    { "field": "frequency", "reason": "not_assessed" }
  ],
  "clarificationQuestions": ["¿Desde cuándo ocurre?"],
  "summary": {
    "descriptiveStatus": "observations_available",
    "reportedFacts": [
      {
        "observationIndex": 0,
        "field": "manifestation",
        "value": "Cansancio durante una semana ficticia de exámenes.",
        "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"]
      },
      {
        "observationIndex": 0,
        "field": "context",
        "contextDomain": "academic",
        "value": "Semana de exámenes sintética.",
        "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"]
      }
    ],
    "emptyObservationsMeaning": "not_evidence_of_absence",
    "interpretationLimits": [
      "descriptive_only",
      "not_a_diagnosis",
      "clinical_severity_not_calculated",
      "not_a_safety_assessment"
    ]
  }
}
```

Campos principales del response:

| Campo | Significado |
| --- | --- |
| `id` | UUID efímero de esta respuesta; no permite una consulta posterior. |
| `status` | Estado de generación; el único valor de éxito es `completed`. |
| `schemaVersion` / `extractorVersion` | Versiones del contrato de extracción y del extractor. |
| `observations` | Observaciones tentativas del contrato `SignalObservation`, con dimensiones posibles, estados de evidencia y referencias fuente. |
| `summary` | Síntesis determinista; `reportedFacts` contiene solo campos `reported`, y `descriptiveStatus` no es una conclusión clínica. |
| `missingInformation` | Campos faltantes con razón explícita, como `not_reported`, `ambiguous` o `not_assessed`. |
| `sourceMessageIds` | Mensajes completados seleccionados en la solicitud y validados como fuente. |

El response también incluye `preliminaryGuidance`, un contrato aditivo versionado (`contractVersion: "1.0"`) para presentación al estudiante. `observations` se mapea determinísticamente desde `summary.reportedFacts`, conserva el índice de observación y los IDs fuente, y no parafrasea el texto. `informationGaps` y `suggestedFollowUpQuestions` reutilizan las listas validadas del resultado existente. `generalGuidance` y `limitations` son textos fijos, no generados por IA ni personalizados. El esquema estricto no admite diagnósticos, scores, severidad ni confianza. La redacción fija requiere revisión profesional antes de presentarla a estudiantes en un piloto.

El request exacto es un objeto estricto con `messageIds`: entre 1 y 20 UUID únicos. No acepta `accountId` ni otras propiedades:

```json
{ "messageIds": ["550e8400-e29b-41d4-a716-446655440010"] }
```

## Prueba manual

En Swagger local (`http://localhost:3000/api-docs`), autoriza un JWT de desarrollo con **Authorize**, abre `POST /api/v1/conversations/{id}/signals/results` y envía el body anterior con una conversación y mensajes sintéticos que pertenezcan a esa cuenta. La cuenta debe tener consentimiento vigente para ambas finalidades; la ruta no crea ni simula consentimientos.

También puede usarse `curl.exe` desde PowerShell, configurando previamente `CONVERSATION_ID`, `MESSAGE_ID` y `JWT_ACCESS_TOKEN` para fixtures locales autorizados:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/conversations/$env:CONVERSATION_ID/signals/results" `
  -H "Authorization: Bearer $env:JWT_ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  --data-raw "{`"messageIds`":[`"$env:MESSAGE_ID`"]}"
```

Esta solicitud sí ejecuta una extracción bajo demanda mediante el proveedor configurado. Para la suite automatizada, el extractor está simulado y no se deben usar conversaciones ni mensajes reales.

El `accountId` forma parte del resultado interno para representar el dueño autorizado, pero se omite de la respuesta pública. El ownership del recurso se deriva únicamente del JWT.

## Síntesis descriptiva

`reportedFacts` se deriva de manera determinista de campos cuyo estado sea exactamente `reported`. Cada hecho contiene índice de observación, campo, texto validado, dominio contextual cuando aplique y referencias a mensajes que ya fueron comprobadas como fuentes permitidas. No se resumen ni parafrasean valores `ambiguous`, `not_reported` o `not_assessed`; continúan representados en la observación y `missingInformation`.

`descriptiveStatus` solo indica si el extractor devolvió observaciones. Si el arreglo está vacío, `emptyObservationsMeaning` declara que eso no es evidencia de ausencia. `clarificationQuestions` conserva las preguntas estructuradas ya validadas. La lista de límites impide interpretar el objeto como diagnóstico, severidad clínica o evaluación de seguridad.

No se incluyen razonamiento interno, confianza no calibrada, puntuaciones ni prioridades clínicas. El contrato `preliminaryGuidance` distingue lo observado, lo faltante y la orientación general sin transformar la ausencia de evidencia en ausencia de dificultades.

## Consentimiento y privacidad

La operación requiere consentimientos vigentes e independientes para `ai_conversation_processing` y `structured_signal_extraction`. El caso de uso conserva los checks existentes antes de cargar mensajes y vuelve a comprobar ambos inmediatamente antes de llamar al extractor. Ausencia, retiro, aviso sustituido o fallo del checker impiden la extracción.

La ruta nueva no escribe conversaciones, mensajes ni resultados. No se añade log con contenido. El procesamiento ya transferido al proveedor no se puede retirar retroactivamente. La respuesta efímera tampoco cambia la política de retención del historial conversacional, que requiere una decisión separada.

## Limitaciones y decisiones pendientes

- No hay GET de consulta por resultado ni recuperación tras cerrar/reiniciar la interacción.
- No hay deduplicación/idempotencia de extracción: repetir la solicitud vuelve a ejecutar la extracción y puede implicar otra transferencia al proveedor.
- Persistencia solo debe evaluarse tras aprobar por separado finalidad, aviso, retención, consecuencias del retiro, supresión, exportación, control de acceso y operación de respaldos.
- `extractorVersion` (`1.0.0`) requiere incremento manual cuando cambie la transformación o comportamiento de extracción de forma material.
- La taxonomía es tentativa y descriptiva; no es instrumento psicométrico ni validación clínica.
- No activa Safety, evaluación preliminar ni monitoreo longitudinal.

## Pruebas y cobertura

Las pruebas unitarias cubren el mapeo de evidencia reportada, salida sin observaciones, información faltante, referencias inválidas, ausencia de campos clínicos y el contrato HTTP. La integración HTTP+PostgreSQL compone JWT, repositorios Drizzle y consentimiento real de `tesis_test_db` con extractor simulado. Verifica respuesta descriptiva, doble consentimiento (ausente y retirado), aislamiento por propietario, no escritura y conservación del contrato `/extract`. La repetición produce otro ID y vuelve a invocar el extractor; no existe consulta posterior porque no hay persistencia.
