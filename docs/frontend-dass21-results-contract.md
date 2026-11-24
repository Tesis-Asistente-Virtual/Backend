# Contrato frontend: resultados DASS-21

## Estado

Este documento distingue el comportamiento normal actual de la respuesta DASS-21 condicionada a autorización exacta de servidor. La ruta `GET /api/v1/preliminary-assessments/{id}/result` está conectada a esa política; la política productiva no contiene autorizaciones, por lo que ninguna versión DASS-21 puede mostrar dimensiones hoy. Si una evaluación no pertenece a una versión registrada en la política, se conserva el contrato histórico `AssessmentResult`. Si la versión está registrada pero la devolución no está autorizada, la ruta puede responder con el DTO DASS-21 genérico `not_available` sin puntuaciones.

Sprint 8C.1 conectó scoring y el adaptador de participante a la composición normal mediante `Dass21VersionAuthorizationRegistry`. El registro productivo está vacío: ningún DASS-21 se administra, puntúa ni divulga en la aplicación normal hoy. La candidata `dass21-spanish-candidate-1.1` permanece fuera del catálogo normal. La administración, el scoring y la divulgación requieren evidencia separada, exacta por versión y controlada por el servidor. Solo la composición loopback `staging:integrated:synthetic` permite probar la candidata pendiente y devuelve respuestas con `technicalTest.scope = "synthetic_only"`; ese contrato no es consumible por participantes. Véase [estado de integración Sprint 8C.1](sprint-8c1-backend-integration-readiness.md).

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

### Administración estructurada (solo cuando el catálogo ofrezca una versión)

Todas las rutas requieren `Authorization: Bearer <accessToken>` y derivan la cuenta del JWT; el cliente no envía `accountId`. El inicio usa `POST /api/v1/preliminary-assessments` con `{ "instrumentVersionId": "<UUID devuelto por /info>" }`. Requiere consentimiento vigente para `preliminary_assessment`; no se debe hardcodear un UUID de DASS-21. El formulario fijado se recupera con `GET /api/v1/preliminary-assessments/{id}/form`. Para contestar, enviar una solicitud por cada pregunta a `POST /api/v1/preliminary-assessments/{id}/responses` con `{ "questionId": "<UUID de la pregunta>", "answer": { "type": "single_choice", "optionId": "<UUID de una opción de esa pregunta>" } }`; son 21 solicitudes, usando solo IDs del formulario y sin `scoringValue`. Finalizar con `POST /api/v1/preliminary-assessments/{id}/complete` y cuerpo JSON vacío `{}`. Consultar después `GET /api/v1/preliminary-assessments/{id}/result`.

En la composición normal actual, DASS-21 no aparece en `/info`: el registro productivo no contiene autorizaciones y la candidata sigue bloqueada. El cliente debe mostrar solo instrumentos realmente devueltos por el backend y manejar el `AssessmentResult` histórico `not_available`; no debe asumir que el DTO DASS-21 está activo.

## B. Contrato DASS-21 integrado y condicionado

El adaptador puro `toDass21ParticipantResult` proyecta el DTO interno `dass21-internal-result-1.0`. La ruta normal lo usa cuando una entrada exacta del registro de servidor reconoce la versión. La rama `available` exige autorización separada para administración, scoring, interpretación y divulgación, además de ownership, finalización, consentimiento vigente y lectura transaccional. El registro productivo está vacío; por tanto, los ejemplos siguientes describen el contrato condicionado y no una capacidad habilitada para participantes.

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

Estas reglas describen el formato y no constituyen autorización para activar la rama `available`.

## F. Requisitos previos a cualquier publicación

1. Selección y revisión psicométrica/profesional de una versión española concreta, incluida su adecuación a estudiantes universitarios de ingeniería de Lima Metropolitana.
2. Verificación documentada de procedencia, permiso/licencia y condiciones de administración digital.
3. Carga y aprobación explícita del instrumento, preguntas, orden y mapeo exactos para la versión; ningún fixture sintético cuenta como aprobación.
4. Soporte interpretativo autorizado para esa versión, scoring e interpretación; el proveedor predeterminado sigue denegando soporte.
5. Textos de presentación revisados por profesionales; aprobación jurídica/ética y del responsable de investigación cuando corresponda.
6. Política aprobada de finalidad, consentimiento, roles y alcance, retención, corrección, retiro, exportación y supresión.
7. Autorización de divulgación para la versión exacta, controlada por servidor y basada en evidencia revisable; un header, parámetro, variable genérica o dato del cliente no puede concederla.
8. Conservar `GetMyInternalDass21Result` dentro de su lectura transaccional, con JWT, ownership, evaluación completada y denegación ante retiro, aviso sustituido, instrumento incompatible o infraestructura no disponible.

## G. Prueba HTTP del router

La suite `tests/integration/dass21-postgres.integration.test.ts` compone `createPreliminaryAssessmentRouter` (router normal, no el servidor synthetic staging) en la URL canónica y le inyecta una autorización sintética local a la prueba para verificar la rama `available` con dos propietarios y 21 respuestas persistidas. Monta además una instancia con el registro productivo vacío y otra con divulgación denegada para comprobar que la candidata real permanece fuera del catálogo y que no se filtran dimensiones. La autorización sintética no modifica el registro productivo ni la aprobación de la candidata. La prueba requiere `TEST_DATABASE_URL` verificada para `tesis_test_db`; sin esa base, este documento no afirma que el recorrido PostgreSQL haya pasado.
9. Integración PostgreSQL focalizada que demuestre denegación por defecto, aislamiento de dos propietarios, respuestas derivadas del score persistido, consentimiento vigente y ausencia de scores ante cualquier fallo.

Hasta que se registren y revisen las autorizaciones correspondientes, el frontend solo debe tratar como disponible el contrato histórico `AssessmentResult`, que mantiene las secciones en `not_available`. No debe anticipar dimensiones ni mostrar scores DASS-21.
