# Contrato frontend — staging integrado sintético

## Acceso

- Base URL: `http://127.0.0.1:3042` (solo loopback local).
- Arranque backend: `npm run staging:integrated:synthetic`.
- CORS: `STAGING_CORS_ALLOWED_ORIGINS` permite únicamente orígenes HTTP(S) exactos separados por comas. Si no se define, no hay acceso cross-origin. No se habilitan credenciales CORS; se envía el JWT como `Authorization: Bearer`.
- La cuenta debe usar `@example.test`; el chat solo acepta el título y mensaje sintéticos fijos documentados en [Sprint 8B.1](sprint-8b1-integrated-synthetic-staging.md).
- Auth: `POST /api/v1/auth/sign-up` (`email`, `password`; mínimo 12 caracteres) y `POST /api/v1/auth/sign-in`; el segundo devuelve `accessToken`, `refreshToken`, `tokenType: "Bearer"`, `expiresIn`. El access token dura 900 s. Ante `401`, reautenticar; no enviar `accountId`.

## Secuencia

1. `GET /api/v1/consents/notices`; guardar el `id` actual por `purpose`.
2. Con JWT, `POST /api/v1/consents/me/decisions` para cada finalidad por separado. El body exacto es `{ "purpose": "...", "noticeVersionId": "<UUID del aviso vigente>", "action": "granted", "idempotencyKey": "<UUID>" }`. Finalidades: `ai_conversation_processing`, `structured_signal_extraction`, `preliminary_assessment`. Confirmar con `GET /api/v1/consents/me`. El retiro bloquea el flujo protegido; una decisión para un propósito no concede otro.
3. `POST /api/v1/conversations` con `{}` (o el título fijo). `POST /api/v1/conversations/{id}/messages` con el único mensaje de prueba permitido. Requiere consentimiento conversacional.
4. Opcionalmente, POST SSE a `/api/v1/conversations/{id}/messages/stream` con el mismo mensaje. Consumir `message.started`, `message.delta`, `message.completed` y, en error de stream, `stream.error`. Como el método es POST, usar `fetch` y leer el body; `EventSource` no representa este contrato. Requiere mantener JWT y consentimiento.
5. Con ambos consentimientos de procesamiento y extracción vigentes, `POST /api/v1/conversations/{id}/signals/results` con `{ "messageIds": ["<UUIDs de mensajes propios seleccionados>"] }`. Responde `preliminaryGuidance` efímero; en este staging sintético las observaciones son vacías y las brechas están marcadas `not_assessed`. No interpretar vacío como ausencia de dificultades. No guardar el resultado en `localStorage`.
6. `GET /api/v1/preliminary-assessments/info`; en esta composición aparece solo la versión candidata, con `technicalAvailability: "technical_test_only"`, `professionalReviewStatus: "pending"` y `approvalStatus: "not_approved"`.
7. Con el consentimiento `preliminary_assessment`, iniciar con `POST /api/v1/preliminary-assessments` y `{ "instrumentVersionId": "00000000-0000-4000-8000-000000008a92" }`. Recuperar el formulario en `GET /api/v1/preliminary-assessments/{id}/form`; mostrar 21 reactivos en `displayOrder` y las opciones devueltas. Enviar cada respuesta a `POST /api/v1/preliminary-assessments/{id}/responses` con `{ "questionId": "<UUID>", "answer": { "type": "single_choice", "optionId": "<optionId de esa pregunta>" } }`. No enviar `scoringValue`.
8. Completar con `POST /api/v1/preliminary-assessments/{id}/complete` y `{}`. Después consultar `GET /api/v1/preliminary-assessments/{id}/result`.

## Resultado técnico: forma exacta

La respuesta es un objeto con `technicalTest` y `result`. **La ruta de dimensiones es `result.dimensions` (no `result.results`)**:

```json
{
  "technicalTest": {
    "scope": "synthetic_only",
    "instrumentApprovalStatus": "not_approved"
  },
  "result": {
    "contractVersion": "dass21-participant-result-1.0",
    "status": "available",
    "assessmentId": "11111111-1111-4111-8111-111111111111",
    "instrument": {
      "code": "DASS-21",
      "instrumentId": "00000000-0000-4000-8000-000000008a91",
      "instrumentVersionId": "00000000-0000-4000-8000-000000008a92",
      "version": "dass21-spanish-candidate-1.1"
    },
    "scoringVersion": "dass21-score-1.0",
    "interpretationVersion": "dass21-conventional-cutoffs-1.0",
    "dimensions": {
      "depression": { "rawScore": 0, "equivalentScore": 0, "category": "normal" },
      "anxiety": { "rawScore": 0, "equivalentScore": 0, "category": "normal" },
      "stress": { "rawScore": 0, "equivalentScore": 0, "category": "normal" }
    },
    "isDiagnostic": false,
    "limitations": [
      "not_a_diagnosis",
      "conventional_categories_are_not_clinical_severity",
      "not_derived_from_conversation",
      "not_for_automated_treatment_or_safety_decisions"
    ]
  }
}
```

Puntajes del bloque son solo ejemplo sintético. No mostrarlos como resultado clínico ni trasladarlos desde chat. El contrato actual de la aplicación normal sigue sin puntuaciones; el resultado anterior está disponible únicamente en el servidor técnico local con etiqueta `technicalTest`.

## Errores principales

- `400`: cuerpo inválido, mensaje distinto al fijo o `scoringValue` enviado por frontend.
- `401`: falta o invalidez del JWT; volver a autenticar.
- `403`: falta o retiro del consentimiento requerido.
- `404`: conversación/evaluación ajena o inexistente.
- `409`: instrumento no disponible o transición incompleta/conflictiva.
- `503`: autorización o extracción temporalmente indisponible.

Un frontend en otra máquina no puede conectarse a `127.0.0.1` del backend. No usar este modo para un piloto ni cambiar el bind a una interfaz pública. La versión candidata y su resultado siguen no aprobados para uso con participantes.

## E2E local

Primero preparar `tesis_staging_db`, aplicar migraciones y avisos por los comandos explícitos documentados en Sprint 8B.1. En una terminal iniciar `npm run staging:integrated:synthetic`. En otra, con `STAGING_DATABASE_URL` apuntando a la misma base local ya preparada, ejecutar `npm run test:staging:e2e`. La prueba no migra ni siembra; si la variable falta, Vitest marca la suite como omitida. Si está definida, comprueba base local, servidor `/health` y avisos sintéticos antes del flujo.
