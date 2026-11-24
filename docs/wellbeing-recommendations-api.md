# API de recomendaciones de bienestar

Estas rutas devuelven sugerencias no clínicas basadas en un análisis conversacional persistido. No vuelven a leer ni procesar mensajes. La función está deshabilitada por defecto y requiere configuración del servidor, allowlist y consentimiento vigente.

## Requisitos antes de usar

- `WELLBEING_RECOMMENDATIONS_ENABLED=true`.
- `WELLBEING_RECOMMENDATIONS_DEPLOYMENT=authorized_pilot`.
- `WELLBEING_RECOMMENDATIONS_ALLOWED_ACCOUNT_IDS` con UUIDs permitidos por el servidor.
- `OPENAI_API_KEY` y `OPENAI_MODEL` para análisis con evidencia low/moderate.
- Migración `0014_wellbeing_recommendations.sql` aplicada al entorno autorizado.
- Aviso vigente publicado para `wellbeing_recommendations`, además de avisos y consentimientos vigentes `ai_conversation_processing`, `structured_signal_extraction` y `conversational_signal_analysis`.

Este repositorio no publica avisos. Sin el nuevo aviso y la aceptación explícita, las rutas responden `403`. La migración no se aplicó durante este cambio.

## Generar o recuperar

`POST /api/v1/me/recommendations/generate`

Header: `Authorization: Bearer <accessToken>`; `Content-Type: application/json`.

Body para usar el análisis vigente más reciente:

```json
{}
```

Body para seleccionar un análisis propio aún vigente:

```json
{ "analysisId": "550e8400-e29b-41d4-a716-446655440010" }
```

El cliente no puede enviar niveles, hallazgos o referencias. Una generación nueva responde `201`; si ya existe un conjunto para ese análisis, responde `200` con el mismo conjunto y sin regenerarlo. Una solicitud concurrente mientras se genera responde `409`.

Ejemplo sintético de respuesta `201`:

```json
{
  "contractVersion": "wellbeing-recommendations-1.0",
  "recommendationSetId": "550e8400-e29b-41d4-a716-446655440030",
  "status": "available",
  "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
  "generatedAt": "2026-11-24T12:00:00.000Z",
  "expiresAt": "2027-02-22T12:00:00.000Z",
  "recommendations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440031",
      "kind": "evidence_based",
      "title": "Divide una tarea en pasos",
      "description": "Elige una parte pequeña de una actividad y decide cuándo te gustaría empezarla.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440032",
      "kind": "evidence_based",
      "title": "Reserva un momento breve",
      "description": "Si te resulta útil, reserva unos minutos para organizar lo que te gustaría atender primero.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440033",
      "kind": "evidence_based",
      "title": "Considera conversar con alguien",
      "description": "Puedes compartir con alguien de confianza qué parte de la situación te gustaría ordenar.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    }
  ],
  "professionalSupportNotice": null,
  "isDiagnostic": false,
  "isClinicalAdvice": false,
  "limitations": [
    "exploratory_conversational_evidence_only",
    "not_a_diagnosis_or_clinical_assessment",
    "not_a_crisis_detector",
    "not_a_substitute_for_professional_care",
    "generated_from_persisted_analysis_not_messages"
  ]
}
```

Si todas las dimensiones son `insufficient_evidence`, o no existe ninguna dimensión `low`/`moderate`, se devuelven tres cards `kind: "general"`, con `dimension: null` y referencias vacías; no se llama a OpenAI ni se inventan hallazgos. Si existe alguna dimensión `high`, no se usa para personalizar autoayuda y se incluye `professionalSupportNotice` voluntario. `high` no significa gravedad clínica ni activa una derivación.

## Consultar latest

`GET /api/v1/me/recommendations/latest` con JWT.

Respuesta sin conjunto vigente:

```json
{ "status": "not_available", "reason": "no_current_recommendations", "isDiagnostic": false }
```

## Errores relevantes

- `400`: JSON inválido, UUID inválido o campos adicionales.
- `401`: JWT ausente o inválido.
- `403`: falta aviso publicado o consentimiento vigente para cualquiera de los cuatro propósitos.
- `404`: el análisis solicitado no existe para la cuenta autenticada o ya venció.
- `409`: generación en curso o conflicto de estado.
- `502`: salida estructurada del proveedor inválida.
- `503`: función deshabilitada o proveedor no configurado/disponible.

La identidad se deriva exclusivamente del JWT. Cada set se vincula a la cuenta y al análisis por FK; el análisis de origen y su vencimiento controlan el acceso y la vida útil. El set expira exactamente con el análisis. La eliminación del análisis elimina en cascada el set.

Las cards son sugerencias generales de bienestar, no tratamientos ni decisiones clínicas. No identifican crisis; no reemplazan atención profesional. Los textos generados requieren revisión de contenido antes de activar un piloto.
