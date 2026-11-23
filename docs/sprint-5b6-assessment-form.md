# Sprint 5B.6 — preparación del formulario de evaluación

## Alcance y estado

Este incremento prepara el backend para administrar formularios estructurados genéricos con instrumentos sintéticos. No carga DASS-21, selecciona traducción, conecta el motor de puntuación al flujo HTTP ni expone puntuaciones. La implementación técnica no constituye aprobación clínica, psicométrica, jurídica o ética.

## Orden versionado

Las preguntas aceptan `displayOrder` (entero de 1 a 200). Al guardar un borrador, el adaptador persiste la posición explícita, o asigna secuencialmente las posiciones según el orden de entrada del borrador existente. El catálogo siempre lee por `instrument_version_id, display_order`; no depende del UUID ni del orden natural de PostgreSQL.

La migración `drizzle/0007_assessment_form_order_and_reauthorization.sql` agrega la columna nullable `display_order`, un índice único parcial por versión y un check de rango. Un trigger impide aprobar versiones sin orden completo, único y contiguo comenzando en 1. Las preguntas de versiones publicadas permanecen inmutables por el trigger ya existente.

La columna se deja nullable para conservar filas históricas. Las versiones antiguas que carezcan de orden siguen almacenadas, pero no aparecen disponibles ni se pueden presentar. No se completa ni reescribe su orden usando UUID: requieren una nueva versión de instrumento y el proceso de aprobación vigente.

## Recuperar formulario y progreso

Ruta añadida: `GET /api/v1/preliminary-assessments/:id/form`.

- Requiere JWT; usa `req.auth.accountId`, no una cuenta de cliente.
- Solo devuelve una evaluación propia en `in_progress` o `paused`.
- Exige que la versión del consentimiento vigente coincida con la fijada a la evaluación.
- Reutiliza la versión exacta de instrumento fijada; no sustituye una versión si el catálogo cambia.
- Devuelve preguntas por `displayOrder` y las respuestas guardadas del propietario.
- Aviso ausente, retirado, rechazado o reemplazado: `403`. Evaluación ajena/inexistente: `404`. Estado cerrado o versión no disponible: `409`.

Respuesta de ejemplo con datos totalmente ficticios:

```json
{
  "assessment": {
    "id": "<assessment-uuid>",
    "assessmentType": "synthetic-form-check",
    "mode": "structured_instrument",
    "status": "in_progress",
    "instrumentVersionId": "<pinned-version-uuid>",
    "createdAt": "<ISO-8601>",
    "startedAt": "<ISO-8601>",
    "completedAt": null,
    "withdrawnAt": null,
    "updatedAt": "<ISO-8601>",
    "responses": []
  },
  "instrument": {
    "instrumentId": "<instrument-uuid>",
    "instrumentVersionId": "<same-pinned-version-uuid>",
    "version": "synthetic-1",
    "effectiveAt": "<ISO-8601>",
    "questions": [
      {
        "id": "<question-uuid>",
        "prompt": "Synthetic neutral prompt",
        "required": true,
        "responseType": "boolean",
        "displayOrder": 1
      }
    ]
  }
}
```

Cada respuesta ya guardada conserva el contrato `AssessmentResponseItem`: `assessmentId`, `instrumentVersionId`, `questionId`, `status`, `answer`, `createdAt`, `updatedAt`. La ruta no incluye campos de scoring.

## Consentimiento cambiado

La decisión de consentimiento no se infiere ni se actualiza por recuperar el formulario. Si se publica un aviso nuevo, el flujo frontend es:

1. Consultar `GET /api/v1/consents/notices` y `GET /api/v1/consents/me`.
2. Mostrar el aviso nuevo y esperar una decisión explícita.
3. Enviar `POST /api/v1/consents/me/decisions` con el schema existente (`purpose`, `noticeVersionId`, `action`, `idempotencyKey`), `purpose: "preliminary_assessment"` y `action: "granted"`.
4. Solo tras recibir éxito, enviar `POST /api/v1/preliminary-assessments/:id/reauthorize` con body omitido o `{}`.
5. Recuperar otra vez `GET /:id/form`. Si la evaluación estaba pausada, reanudar explícitamente con `POST /:id/resume` y `{}`.

`POST /:id/reauthorize` no registra una decisión. Requiere el grant actual verificado por Consent, solo cambia la referencia del aviso en evaluaciones abiertas y conserva estado, respuestas e instrumento. Una nueva decisión por sí sola no cambia la referencia de la evaluación. No reabre estados `withdrawn`, `completed` o `expired`.

La operación de escritura vuelve a validar aviso y decisión en la transacción con locks de Consent y compare-and-swap de `updatedAt`. La operación queda ordenada frente a retiro/sustitución: si el cambio de consentimiento confirma primero, la escritura falla cerrada; si la escritura adquiere primero la autorización y confirma, queda antes del cambio concurrente. No se hacen llamadas a proveedores.

## Endpoints reutilizados

El frontend conserva los contratos existentes:

| Acción | Método y ruta | Nota |
|---|---|---|
| Ver instrumentos disponibles | `GET /api/v1/preliminary-assessments/info` | Incluye `displayOrder`; vacío significa no disponible. |
| Iniciar | `POST /api/v1/preliminary-assessments` | `{ "instrumentVersionId": "<uuid>" }`; consentimiento e instrumento disponible obligatorios. |
| Listar evaluaciones | `GET /api/v1/preliminary-assessments` | Metadatos propios; respuestas de una evaluación abierta se omiten si el aviso no coincide o falla la consulta de autorización. |
| Leer estado/progreso | `GET /api/v1/preliminary-assessments/:id` | Evaluación propia; para evaluación abierta requiere consentimiento vigente. |
| Leer formulario/progreso | `GET /api/v1/preliminary-assessments/:id/form` | Nueva ruta; devuelve versión fijada, preguntas ordenadas y respuestas. |
| Guardar respuesta | `POST /api/v1/preliminary-assessments/:id/responses` | `{ "questionId": "<uuid>", "answer": <respuesta según tipo o null> }`. |
| Reautorizar evaluación abierta | `POST /api/v1/preliminary-assessments/:id/reauthorize` | Nueva ruta; body omitido o `{}` después del grant explícito actual. |
| Pausar/reanudar/retirar | `POST /:id/pause`, `/resume`, `/withdraw` | Body omitido o `{}`; reanudar requiere consentimiento vigente. |
| Finalizar | `POST /api/v1/preliminary-assessments/:id/complete` | Resultado público sigue no puntuado. |
| Consultar resultado público | `GET /api/v1/preliminary-assessments/:id/result` | No expone puntajes internos. |

Los schemas strict/OpenAPI se actualizaron para el formulario. Rechazan propiedades adicionales en requests donde ya aplica el schema estricto. En el listado, los metadatos se conservan durante un cambio de consentimiento para que el frontend pueda iniciar su recuperación, pero las respuestas no se incluyen hasta que la autorización coincida. Errores usan el formato existente `{ "error": "..." }`: `401` autenticación, `403` consentimiento, `404` no encontrado/no propio, `409` estado/conflicto/no disponible, `400` request inválido y `500` fallo interno sanitizado.

## Archivos principales

- Dominio y persistencia: `src/modules/preliminary-assessment/domain/model/instrument.ts`, `domain/model/preliminary-assessment.ts`, `infrastructure/persistence/schema.ts`, `drizzle-instrument-catalog.ts`, `drizzle-preliminary-assessment-repository.ts`.
- Aplicación: `application/internal/query-services/get-my-assessment-form.ts`, `application/internal/command-services/reauthorize-assessment.ts`, actualización de `get-my-assessment.ts`.
- REST/OpenAPI: `interfaces/rest/create-preliminary-assessment-router.ts`, `resources/preliminary-assessment-controller.ts`, `interfaces/rest/openapi.ts`.
- Migración: `drizzle/0007_assessment_form_order_and_reauthorization.sql` y metadata Drizzle 0007.
- Tests: tests de dominio/casos de uso y `tests/integration/preliminary-assessment.integration.test.ts`.
- Guía frontend actualizada: `docs/sprint-5b5-frontend-assessment-guide.md`.

## Pruebas y base de datos

Se añadieron pruebas unitarias de orden/versiones, formulario propio, progreso, consentimiento actualizado, reautorización, cierre y rechazo seguro. La integración PostgreSQL cubre HTTP + base real, aislamiento, orden, actualización de aviso y restricciones SQL, con fixtures sintéticos.

`TEST_DATABASE_URL` debe estar configurada hacia un servidor loopback y la base exacta `tesis_test_db`. No se usa `DATABASE_URL` como fallback. La integración requiere que la migración 0007 ya se haya aplicado manualmente a la base aislada; esta tarea no conecta, migra ni modifica ninguna base.

## Pendiente antes de un instrumento real

- Seleccionar y revisar una versión exacta en español; comprobar procedencia, evidencia para población objetivo y condiciones de uso digital.
- Obtener aprobación profesional, psicométrica, ética y jurídica pertinente.
- Cargar sus preguntas solo mediante el flujo formal de aprobación y asignar el orden oficial sin modificaciones.
- Definir retención, supresión, exportación y acceso a datos sensibles.
- Definir cómo y cuándo correr el scoring interno; permanece sin registrar automáticamente.
- Mantener bloqueada la devolución de puntajes, severidades o diagnósticos al estudiante y no crear acceso de investigación sin roles, alcance y auditoría aprobados.
