# Consumo de `preliminaryGuidance` en frontend

## Alcance y contrato

`POST /api/v1/conversations/{id}/signals/results` devuelve un resultado descriptivo efímero. Requiere JWT y consentimiento vigente para `ai_conversation_processing` y `structured_signal_extraction`; el backend valida propiedad y referencias de mensajes. El request conserva el contrato existente `{ "messageIds": ["<uuid>"] }`. No se envía `accountId`.

La respuesta ya contiene secciones estructuradas suficientes. No se añaden propiedades al DTO ni es necesario interpretar texto libre para saber qué sección mostrar:

- `preliminaryGuidance.observations`: solo hechos que ya estaban marcados como `reported`; cada elemento incluye `field`, `text`, `sourceObservationIndex` y `sourceMessageIds` seleccionados. `contextDomain` es opcional.
- `preliminaryGuidance.informationGaps`: campo y motivo (`not_reported`, `ambiguous` o `not_assessed`). Un dato no reportado no significa que esté ausente en la vida de la persona.
- `preliminaryGuidance.suggestedFollowUpQuestions`: preguntas opcionales; pueden mostrarse o ignorarse.
- `preliminaryGuidance.generalGuidance`: texto fijo de revisión/corrección voluntaria.
- `preliminaryGuidance.limitations`: límites explícitos y versionados junto con `contractVersion`.

La respuesta superior mantiene `observations`, `missingInformation`, `clarificationQuestions` y `summary` por compatibilidad. `preliminaryGuidance` es una presentación estructurada adicional construida determinísticamente desde `summary.reportedFacts`, brechas y preguntas existentes; no hace otra llamada al modelo. El resultado no se guarda y no se puede recuperar por su ID.

Los textos fijos del contrato aún no cuentan con aprobación profesional. Consulta el [inventario y matriz de revisión](sprint-5c3-guidance-review.md); frontend no debe describirlos como validados.

## Ejemplo sintético

Los UUID y textos siguientes son ficticios. La respuesta completa y normativa se publica como ejemplo del `200` en Swagger (`/api-docs`); este fragmento muestra cómo consumir las secciones:

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

El fragmento anterior ilustra secciones, pero para ejemplos ejecutables usa el objeto `200` íntegro de Swagger porque el contrato estricto conserva también las observaciones de extracción y los hechos del resumen.

## Reglas de presentación

1. Renderiza `preliminaryGuidance.observations` como expresiones reportadas en los mensajes seleccionados, no como hechos clínicos confirmados. Si se muestra una observación, conserva una acción de trazabilidad hacia los mensajes identificados por `sourceMessageIds`; nunca cargues contenido de otra conversación.
2. Presenta las brechas como información no disponible en el contexto procesado. No conviertas `not_reported`, `ambiguous` ni `not_assessed` en una afirmación de ausencia.
3. Ofrece `suggestedFollowUpQuestions` como opciones, sin bloquear ni presionar a la persona para responder.
4. Muestra `generalGuidance` y `limitations` de forma legible. No sustituyas sus límites por una interpretación propia.
5. No añadas diagnósticos, probabilidades, puntuaciones, colores/etiquetas de severidad, evaluaciones de seguridad ni derivaciones automáticas. No muestres puntuaciones DASS-21; son ajenas a este resultado.
6. Si `observations` está vacío o `summary.descriptiveStatus` es `no_observations`, comunica únicamente que no se generaron observaciones para los mensajes seleccionados. No digas que no hay síntomas o riesgo.
7. Trata los datos solo en memoria de la vista actual: no los persistas en almacenamiento local, analítica o logs. Una recarga requiere una solicitud explícita nueva y vuelve a ejecutar el procesamiento sujeto a consentimiento.

## Evidencia y límites de implementación

El mapeo de orientación copia únicamente `summary.reportedFacts`; Zod limita las referencias de cada observación a `preliminaryGuidance.sourceMessageIds`. El DTO estricto rechaza propiedades adicionales, incluyendo campos de diagnóstico, puntuación o confianza. El request selecciona de 1 a 20 IDs únicos y el caso de uso valida que sean mensajes completados de la conversación propia. La orientación no determina riesgo ni reemplaza Safety, que permanece desactivado.

El lenguaje mostrado por este contrato todavía requiere revisión profesional antes de considerarlo orientación psicológica validada. La respuesta es descriptiva, no constituye evaluación clínica ni garantiza que el extractor haya identificado todo lo expresado.
