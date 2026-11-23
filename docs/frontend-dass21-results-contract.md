# Contrato frontend: resultados DASS-21

## Estado

Este documento separa el contrato HTTP que existe hoy del DTO de participante preparado para una posible fase posterior. **El DTO futuro no está habilitado, no está conectado a una ruta y no debe ser tratado como respuesta actual.** `GET /api/v1/preliminary-assessments/{id}/result` continúa devolviendo exclusivamente `AssessmentResult`, con sus secciones de puntuación e interpretación en `not_available`.

El backend no dispone de una versión española de DASS-21 aprobada para la población de la tesis. El adaptador predeterminado de soporte interpretativo deniega la disponibilidad. No hay autorización para mostrar puntuaciones o categorías a participantes.

## A. Contrato que puede consumir frontend hoy

### `GET /api/v1/preliminary-assessments/{id}/result`

- Autenticación: `Authorization: Bearer <accessToken>`.
- `id`: UUID de la evaluación en la ruta. No se envía `accountId`.
- El controlador verifica JWT; el caso de uso consulta la evaluación del propietario y exige estado `completed`.
- `200`: el recurso histórico `AssessmentResult`.
- `401`: token ausente o inválido.
- `400`: `id` inválido.
- `404`: evaluación ajena/inexistente o sin resultado disponible para el caso de uso.

Ejemplo sintético de respuesta `200` actual:

```json
{
  "schemaVersion": "1.0",
  "assessmentId": "11111111-1111-4111-8111-111111111111",
  "instrumentVersionId": "22222222-2222-4222-8222-222222222222",
  "calculatedAt": "2026-01-05T00:00:00.000Z",
  "instrumentScores": { "status": "not_available", "reason": "no_approved_scoring_rules" },
  "interpretation": { "status": "not_available", "reason": "no_approved_scoring_rules" },
  "attentionPriority": { "status": "not_available", "reason": "no_approved_scoring_rules" },
  "safetyState": { "status": "not_available", "reason": "not_assessed" }
}
```

`instrumentVersionId` puede ser `null`; cuando no hay instrumento asociado, las secciones no disponibles pueden usar `no_approved_instrument`. Este contrato no contiene `rawScore`, `equivalentScore`, categorías ni detalles del score interno. No debe interpretarse `not_available` como puntuación cero.

En el código actual, esta lectura del resultado histórico no consulta `GetMyInternalDass21Result` ni hace una revalidación de consentimiento de DASS-21: su cuerpo no contiene puntuaciones ni categorías. Cualquier publicación futura deberá usar la frontera interna transaccional y volver a definir su contrato de autorización antes de conectarse a HTTP.

## B. Contrato futuro preparado, no habilitado

El componente OpenAPI `Dass21ParticipantResultFuture` y el adaptador puro `toDass21ParticipantResult` describen una posible proyección pública del DTO interno `dass21-internal-result-1.0`. El componente OpenAPI no está referenciado por la operación `/result`; el adaptador no está compuesto en el router ni en el controlador. Su existencia no publica datos ni constituye autorización.

Ejemplo ficticio de la rama `available` —solo para mostrar la forma del DTO, no representa a una persona, no es un resultado producido por la API y no aprueba el instrumento—:

```json
{
  "contractVersion": "dass21-participant-result-1.0",
  "status": "available",
  "assessmentId": "11111111-1111-4111-8111-111111111111",
  "instrument": {
    "code": "DASS-21",
    "instrumentId": "33333333-3333-4333-8333-333333333333",
    "instrumentVersionId": "22222222-2222-4222-8222-222222222222",
    "version": "synthetic-unapproved-v1"
  },
  "scoringVersion": "dass21-score-1.0",
  "interpretationVersion": "dass21-conventional-cutoffs-1.0",
  "dimensions": {
    "depression": { "rawScore": 4, "equivalentScore": 8, "category": "normal" },
    "anxiety": { "rawScore": 5, "equivalentScore": 10, "category": "mild" },
    "stress": { "rawScore": 17, "equivalentScore": 34, "category": "extremely_severe" }
  },
  "isDiagnostic": false,
  "limitations": [
    "not_a_diagnosis",
    "conventional_categories_are_not_clinical_severity",
    "not_derived_from_conversation",
    "not_for_automated_treatment_or_safety_decisions"
  ]
}
```

La rama futura `not_available` entrega solo `contractVersion`, `status`, `assessmentId`, el motivo genérico `result_not_available`, `isDiagnostic: false` y limitaciones. El adaptador colapsa deliberadamente los motivos internos (por ejemplo, consentimiento faltante o score no disponible) para no revelar detalles internos. No incluye cuenta, categoría agregada ni diagnóstico.

## C. Dimensiones y categorías

El contrato mantiene exactamente tres dimensiones independientes: `depression`, `anxiety` y `stress`. Cada una contiene `rawScore` (0–21), `equivalentScore` (0–42, igual a `rawScore × 2`) y una categoría convencional: `normal`, `mild`, `moderate`, `severe` o `extremely_severe`. No existe categoría global.

Las etiquetas son bandas convencionales de interpretación del DASS-21 equivalente conforme a `dass21-conventional-cutoffs-1.0`; describen rangos de puntuación del instrumento y **no** diagnostican trastornos, no miden riesgo inmediato y no prueban ausencia de dificultades. El adaptador solo proyecta el resultado ya calculado; no recalcula respuestas, puntajes ni categorías.

## D. Diferencia frente a `preliminaryGuidance`

`preliminaryGuidance` pertenece al resultado conversacional efímero: presenta observaciones reportadas con referencias a mensajes, brechas de información, preguntas opcionales y textos fijos orientativos. No produce puntajes DASS-21.

El contrato DASS-21 futuro deriva exclusivamente de respuestas estructuradas a una versión concreta del instrumento y del motor determinista versionado. No se calcula desde conversaciones, mensajes, extracción de señales ni `preliminaryGuidance`. Ninguno de los dos contratos entrega un diagnóstico.

## E. Reglas de presentación si alguna vez se autoriza

- No mostrar porcentajes, probabilidades, diagnóstico ni una categoría global.
- No presentar las categorías como severidad clínica ni como evaluación de peligro.
- No inferir mejoría o deterioro desde la conversación.
- Mantener visibles las limitaciones y la versión del instrumento/reglas.
- No traducir/reformular nombres de categorías como conclusiones clínicas sin revisión profesional.
- No tratar `normal` como prueba de que no existen problemas.

Estas reglas son criterios de diseño; no autorizan la activación del contrato.

## F. Requisitos previos a cualquier publicación

1. Selección y revisión psicométrica/profesional de una versión española concreta, incluida su adecuación a estudiantes universitarios de ingeniería de Lima Metropolitana.
2. Verificación documentada de procedencia, permiso/licencia y condiciones de administración digital.
3. Carga y aprobación explícita del instrumento, preguntas, orden y mapeo exactos para la versión; ningún fixture sintético cuenta como aprobación.
4. Soporte interpretativo autorizado para esa versión, scoring e interpretación; el proveedor predeterminado sigue denegando soporte.
5. Textos de presentación revisados por profesionales; aprobación jurídica/ética y del responsable de investigación cuando corresponda.
6. Política aprobada de finalidad, consentimiento, roles y alcance, retención, corrección, retiro, exportación y supresión.
7. Autorización de publicación que se origine exclusivamente en configuración/decisión controlada por el servidor y falle cerrada. Una bandera genérica o dato del cliente no puede concederla.
8. Composición futura con JWT, ownership, evaluación completada y `GetMyInternalDass21Result` dentro de su lectura transaccional; denegación ante retiro, aviso sustituido, instrumento no compatible o infraestructura no disponible.
9. Pruebas HTTP y PostgreSQL focalizadas que demuestren publicación denegada por defecto, autorización del propietario, consentimiento vigente, no exposición de scores ante cualquier fallo y preservación del contrato actual.

Hasta que se satisfagan y revisen esos requisitos, el frontend solo puede integrar el contrato histórico `AssessmentResult` que hoy entrega `not_available`; no debe anticipar la rama futura ni mostrar scores DASS-21.
