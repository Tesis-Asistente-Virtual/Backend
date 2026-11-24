# Sprint 8C.1 — estado de integración backend

## Estado actual

La aplicación normal compone Auth/JWT, Consent, Conversations con el proveedor OpenAI configurado, extracción explícita, `preliminaryGuidance` y PreliminaryAssessment. La composición normal ahora también conecta scoring y resultado DASS-21 mediante una política de versión del servidor; no se añadió otra implementación de esos módulos.

El flujo de conversación no calcula puntuaciones DASS-21. En la composición normal la puntuación se invoca al completar una evaluación estructurada únicamente si la versión exacta tiene autorización de administración y scoring en el registro de servidor. La política de producción está vacía actualmente. La devolución HTTP requiere además autorización independiente de divulgación y soporte interpretativo para la misma versión. En staging sintético, la composición aislada exige `STAGING_DATABASE_URL` verificada como PostgreSQL local `tesis_staging_db`, servidor de loopback y avisos sintéticos; usa proveedores deterministas y marca su respuesta como `synthetic_only`.

La candidata `dass21-spanish-candidate-1.1` permanece `draft / pending / not_approved`. La matriz de decisiones profesional mantiene pendientes la aceptación del texto, pertinencia poblacional, autorización de administración, políticas de datos y devolución de resultados. La lista de autorizaciones normal no incluye ninguna versión; el catálogo aprobado por sí solo no activa DASS-21.

## Contrato que puede integrar frontend hoy

- Auth, avisos/decisiones de consentimiento, conversación REST/SSE y `preliminaryGuidance`: usar los contratos descritos en [integración Backend–Frontend](backend-frontend-integration-contract.md). Las finalidades de conversación, extracción y evaluación se aceptan por separado.
- PreliminaryAssessment normal: `GET /api/v1/preliminary-assessments/info` lista únicamente instrumentos disponibles según las reglas normales; `POST /api/v1/preliminary-assessments` inicia una evaluación de esos instrumentos. El formulario fijado se obtiene con `GET /api/v1/preliminary-assessments/{id}/form`; las respuestas se envían individualmente a `POST /api/v1/preliminary-assessments/{id}/responses` con `{ "questionId": "<uuid>", "answer": { "type": "single_choice", "optionId": "<optionId de la pregunta>" } }`; no se envía `scoringValue`. Completar usa `POST /api/v1/preliminary-assessments/{id}/complete` con `{}`.
- Resultado normal actual: `GET /api/v1/preliminary-assessments/{id}/result` conserva el `AssessmentResult` histórico mientras no haya una versión exacta en la política. Sus secciones están `not_available`; no contiene `dimensions`, `rawScore`, `equivalentScore` ni categorías. `not_available` no equivale a cero.
- Resultado DASS-21 condicionado: la misma ruta, cuando la versión exacta esté registrada por el servidor, responde `{ "result": Dass21ParticipantResult }`. Con administración/scoring autorizados pero divulgación ausente, `result.status` es `not_available` y no hay dimensiones. Solo cuando la divulgación esté autorizada para esa versión y la lectura transaccional verifique propietario, evaluación completada, respuestas, mapeo y consentimiento devuelve `result.status: "available"` con las dimensiones y `isDiagnostic: false`. La forma del DTO se documenta en [contrato frontend DASS-21](frontend-dass21-results-contract.md); el registro normal sigue sin entradas, así que esa rama no está disponible hoy.
- El `accountId` siempre se deriva del JWT. El frontend solo puede operar evaluaciones propias. La operación de evaluación exige consentimiento vigente `preliminary_assessment`; si falta, fue retirado o el aviso cambió, el servidor rechaza/bloquea la operación de acuerdo con su estado.

Los métodos, errores y los contratos exactos de Auth, Consent, chat y guía están en el documento de integración citado arriba. Los detalles del resultado DASS actual y condicionado se mantienen en [contrato frontend DASS-21](frontend-dass21-results-contract.md).

## Entorno sintético, no piloto

El modo sintético separado se inicia con `npm run staging:integrated:synthetic` y sirve en `http://127.0.0.1:3042`. El E2E focalizado es `npm run test:staging:e2e`. Acepta solo avisos ya preparados para prueba, el mensaje sintético fijo y la candidata exacta; no se monta desde el servidor normal. Su ejemplo de resultado `dass21-participant-result-1.0` contiene tres dimensiones, pero siempre se presenta con `technicalTest.scope: "synthetic_only"` e `instrumentApprovalStatus: "not_approved"`. No usar la base, los tokens ni los datos de ese modo para participantes.

## Registro administrativo de autorización

La aplicación normal usa `Dass21VersionAuthorizationRegistry` como fuente exclusivamente de servidor. Para registrar una versión después de recibir decisiones verificables, un cambio revisado debe añadir una entrada que identifique `instrumentId`, `instrumentVersionId` y `instrumentVersion` exactos, con evidencia separada para administración y scoring (referencia documental, alcance, responsable/rol y fecha). El scoring fija `mappingVersion` y `dass21-score-1.0`; el soporte interpretativo fija `dass21-conventional-cutoffs-1.0`. `participantDisclosure` es una decisión separada, ligada a `dass21-participant-result-1.0`, y requiere soporte interpretativo, su referencia, alcance, responsable y fecha.

El proceso no acepta encabezados, query params ni datos del cliente; no modifica directamente estados en PostgreSQL. Primero debe publicarse el instrumento mediante el flujo existente y con aprobación/licencia documentadas. Luego se agrega la configuración de servidor asociada a la misma versión; una revisión posterior puede autorizar scoring o divulgación por separado. El registro de producción permanece vacío hasta que se aprueben esos artefactos.

## Bloqueos para el piloto y la devolución de resultados

Antes de habilitar DASS-21 en una composición para personas, registrar evidencia verificable para la versión concreta: revisión profesional y pertinencia poblacional, condiciones de uso/administración digital, autorización institucional/ética aplicable, consentimiento informado, manejo y retención de respuestas, tratamiento de respuestas sensibles y protocolo revisado de atención. La conformidad verbal indicada no se registra como aprobación formal.

La composición normal contiene el lector interno y una proyección HTTP condicional; el registro vacío impide invocarlos para versiones DASS no autorizadas. La publicación de resultados requiere además autorización independiente: soporte interpretativo autorizado para la misma versión, textos de presentación revisados, política de acceso/devolución y decisión documentada sobre puntuaciones y categorías. Hasta entonces el contrato público no incluye puntajes. No se activa con flags enviados por el cliente ni con un interruptor genérico del servidor. El procedimiento local de publicación está descrito en [dass21-local-publication-procedure.md](dass21-local-publication-procedure.md); no se ejecutó ni contiene autorizaciones reales.

`preliminaryGuidance` sigue siendo una respuesta conversacional efímera trazada a mensajes seleccionados; DASS-21 deriva exclusivamente de las 21 respuestas estructuradas. No se mezclan ambas fuentes. No hay puntuación derivada del chat, diagnóstico, Safety ni comparación longitudinal.
