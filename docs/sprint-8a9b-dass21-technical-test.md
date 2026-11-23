# Sprint 8A.9B — Cuestionario DASS-21 en prueba técnica aislada

## Estado y separación de aprobación

Se añadió una composición Express independiente para una prueba técnica local con cuentas ficticias. Reutiliza las rutas y casos de uso de PreliminaryAssessment, pero sustituye únicamente la política del catálogo por una regla de disponibilidad técnica que acepta una sola versión exacta del candidato cotejado.

La candidata se persiste como borrador (`status=draft`, `approval_status=pending`, `approved_at=NULL`, `approval_reference=NULL`, `license_status=not_reviewed`). El catálogo global sigue exigiendo `approved`; no se modificó ni publicó la candidata. La disponibilidad técnica no equivale a aprobación clínica, institucional, ética, profesional ni a autorización para participantes.

La composición no está montada en `src/app.ts`, `src/server.ts`, `npm run dev` ni `npm start`. Su fábrica además exige `TEST_DATABASE_URL` válida y consulta la identidad y dirección real del servidor PostgreSQL antes de crear el router.

## Requisitos y arranque

Requisitos:

- PostgreSQL local con el esquema de pruebas actualizado mediante las migraciones aditivas `0009_isolated_dass21_technical_test.sql` y `0010_technical_test_dass21_mapping.sql`. Las migraciones no se aplican automáticamente.
- `TEST_DATABASE_URL` definida para el proceso y apuntando exactamente a `tesis_test_db` en `localhost`, `127.0.0.1` o `::1`.
- Aviso vigente `preliminary_assessment` ya publicado en la base de test. El entrypoint no publica avisos. Si no existe, se detiene.
- Node no puede estar en `NODE_ENV=production`.

PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgres://<usuario>:<clave>@localhost:5432/tesis_test_db'
# Opcional para permitir el origen exacto del frontend local; sin esto, CORS permanece cerrado.
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173'
npm run dass21:technical-test
```

No colocar esas variables en `.env` para este procedimiento. El proceso conecta exclusivamente mediante `TEST_DATABASE_URL`; no consulta `DATABASE_URL` ni `TEST_DATABASE_URL` como fallback. Escucha solo en `127.0.0.1:3031`.

El entrypoint asegura de forma idempotente un único borrador de fixture. Si encuentra IDs ocupados o contenido/estado distinto, se detiene sin sobrescribir. Crea una cuenta sintética de acceso temporal, genera un JWT con una clave aleatoria en memoria y muestra el token una vez en la consola. El JWT dura una hora y deja de ser verificable al reiniciar el proceso. No compartirlo. Al detener el servidor con Ctrl+C se elimina únicamente la cuenta sintética creada por ese proceso; el borrador del instrumento permanece para permitir la siguiente ejecución idempotente.

## Rutas utilizables en este servidor de test

Base URL: `http://127.0.0.1:3031`. Las rutas de evaluación conservan los contratos actuales:

1. `GET /api/v1/consents/notices`
2. `POST /api/v1/consents/me/decisions` con JWT y decisión explícita para la finalidad `preliminary_assessment`, aviso vigente, acción y `idempotencyKey` UUID.
3. `GET /api/v1/consents/me` con JWT para confirmar estado.
4. `GET /api/v1/preliminary-assessments/info` con JWT; en esta composición solo lista el candidato DASS-21 exacto si su fixture sigue íntegro.
5. `POST /api/v1/preliminary-assessments` con `{"instrumentVersionId":"00000000-0000-4000-8000-000000008a92"}`.
6. `GET /api/v1/preliminary-assessments/{id}/form` para obtener el formulario ordenado, las instrucciones y el periodo originales, además de `technicalAvailability: "technical_test_only"`, `professionalReviewStatus: "pending"` y `approvalStatus: "not_approved"`. La respuesta no contiene `scoringValue`.
7. `POST /api/v1/preliminary-assessments/{id}/responses` por ítem con `{"questionId":"<UUID del formulario>","answer":{"type":"single_choice","optionId":"dass21-candidate-option-0"}}`. El servidor obtiene el valor de puntuación de la definición versionada; el cliente no puede enviarlo.
8. `POST /api/v1/preliminary-assessments/{id}/complete` con `{}` después de guardar los 21 ítems. Al confirmar la finalización, esta composición ejecuta `ScoreCompletedDass21Assessment`, que resuelve los `optionId` contra el formulario del servidor, usa el mapeo congelado `dass21-technical-test-map-1.0` y persiste las tres subescalas con `dass21-score-1.0`. Una repetición es idempotente. La respuesta de finalización conserva su contrato anterior `not_available`.
9. `GET /api/v1/preliminary-assessments/{id}/result` en **este servidor aislado** lee el score dentro de la unidad de trabajo transaccional y devuelve el adaptador `dass21-participant-result-1.0`, envuelto con el indicador `technicalTest`. Requiere el mismo JWT, propietario y consentimiento vigente.

Ejemplo sintético de la respuesta técnica (valores ilustrativos de una secuencia de respuestas ficticias):

```json
{
  "technicalTest": { "scope": "synthetic_only", "instrumentApprovalStatus": "not_approved" },
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
      "depression": { "rawScore": 7, "equivalentScore": 14, "category": "moderate" },
      "anxiety": { "rawScore": 5, "equivalentScore": 10, "category": "moderate" },
      "stress": { "rawScore": 9, "equivalentScore": 18, "category": "mild" }
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

Si aún no hay score o la lectura/autorización no puede completarse, `result.status` es `not_available`; las causas internas no se filtran. Otro propietario recibe `404`. No hay categoría agregada.

Todos los endpoints protegidos requieren `Authorization: Bearer <token>`. La cuenta y el token impresos pertenecen a una identidad ficticia creada para este proceso. El consentimiento debe registrarse explícitamente; tener el token no lo concede.

## Garantías y alcance

- El proceso se niega a iniciar si la URL falta, apunta a otra base/host, el proceso está en producción, la conexión resuelta no es loopback `tesis_test_db`, o no existe un aviso vigente.
- No se crea ningún endpoint nuevo. El router técnico expone las rutas existentes solo dentro del servidor aislado.
- El fixture debe coincidir exactamente con la candidata fuente, el orden 1–21, opciones y scoring values; no puede sustituirse una versión ocupada.
- Los `optionId` se validan dentro de la pregunta indicada; el modelo exige unicidad por pregunta, no global por instrumento. El fixture candidato reutiliza `dass21-candidate-option-0` a `-3` en cada reactivo. Por eso, reenviar el ID de una pregunta distinta no constituye una combinación inválida si ese mismo ID también está definido para la pregunta indicada. Un ID ausente de la pregunta sí se rechaza antes de persistir.
- JWT, propiedad, consentimiento versionado, revalidación transaccional de respuestas, respuestas progresivas, finalización y aislamiento de cuentas se conservan mediante los casos de uso/repositorios existentes.
- El catálogo y el servidor normales no muestran el borrador técnico.
- La guarda PostgreSQL anterior a 0009 exigía `status=approved` al insertar una evaluación y rechazaba el borrador técnico. 0009 conserva esa regla por defecto y permite el UUID fijo del candidato solo cuando los repositorios de evaluación y respuestas de la composición aislada establecen un parámetro PostgreSQL local a la transacción. También se exige `approval_status=pending` y ausencia de metadatos de aprobación. Los repositorios normales nunca establecen ese parámetro. Cada escritura mantiene la validación de consentimiento en su transacción.
- La evaluación completada conserva el resultado histórico `not_available`. Solo el router técnico conecta scoring y resultado; el router normal continúa respondiendo `not_available` sin puntajes ni categorías. No hay scores en el chat.
- La clasificación convencional se calcula solo dentro de esta composición y no representa revisión profesional, autorización institucional, validez clínica ni permiso para participantes. La candidata permanece `draft/pending/not_reviewed`.
- No hay uso con participantes reales ni aprobación documentada. La conformidad verbal no modifica este estado.

## Pruebas

Unitarias:

```powershell
npm test
```

Integración HTTP + PostgreSQL, únicamente tras configurar `TEST_DATABASE_URL` para `tesis_test_db` local:

```powershell
npm run db:migrate:test
npx vitest run tests/integration/dass21-technical-test.integration.test.ts
```

`db:migrate:test` ejecuta migraciones únicamente después de validar `TEST_DATABASE_URL` contra `localhost`/loopback y `tesis_test_db`. No sustituirla por `DATABASE_URL` o `DEMO_DATABASE_URL`. Este incremento requiere aplicar 0010 después de 0009 antes de ejecutar la integración; la migración no se ejecutó como parte de esta implementación.

El test valida consentimiento HTTP, catálogo normal sin el candidato, formulario de 21 ítems, respuestas por `optionId`, scoring determinista de tres dimensiones, persistencia idempotente, categorías, lectura autorizada, retiro, ownership, opción inválida, contrato normal sin scores y estado de aprobación inalterado.

La integración debe ejecutarse después de aplicar 0009 y 0010 en la base local de pruebas. El endpoint del servidor normal conserva el rechazo del candidato y `not_available` sin scores; el test lo comprueba junto con la respuesta técnica del borrador pendiente.

## Siguiente incremento

El flujo técnico sigue limitado a respuestas sintéticas y `tesis_test_db` local. No habilita el instrumento para estudiantes ni autoriza devolución de resultados fuera de la composición de prueba.
