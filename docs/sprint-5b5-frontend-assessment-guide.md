# Sprint 5B.5 — Guía de frontend para PreliminaryAssessment

## Alcance y etiqueta de disponibilidad

Esta guía documenta contratos existentes y los bloqueos para una futura experiencia DASS-21. No constituye aprobación para mostrar cuestionario ni puntuaciones.

- **IMPLEMENTADO**: JWT, avisos/decisiones de consentimiento, catálogo de instrumentos disponibles, ciclo de vida de evaluación, respuestas progresivas, pausa/reanudación/retiro, finalización y resultado público sin puntuaciones.
- **PREPARADO**: scoring DASS-21 determinista interno y persistencia separada; servicio interno 5B.4 con consentimiento y controles de propiedad.
- **PENDIENTE**: traducción concreta aprobada, derechos de uso digital y protocolo de resultados/acceso. El backend ahora dispone de orden versionado y recuperación del formulario fijado; esto no aprueba contenido ni habilita DASS-21 real.
- **BLOQUEADO**: no hay DASS-21 real cargado/aprobado. Si `GET /info` no ofrece una versión aprobada, la interfaz no debe iniciar ni simular el cuestionario.

Base local OpenAPI: `http://localhost:3000/api-docs`. Los ejemplos que siguen son esquemáticos/sintéticos: sustituir UUIDs por IDs recibidos del servidor; nunca hardcodear `accountId`.

## Convenciones comunes

Enviar `Authorization: Bearer <accessToken>` y `Content-Type: application/json` en rutas protegidas. La identidad se obtiene del JWT. No guardar tokens en logs ni enviar `accountId` en requests. Para errores el backend devuelve `{ "error": "mensaje seguro" }`; no asumir detalles internos.

Rutas base:

```text
/api/v1/consents
/api/v1/preliminary-assessments
```

## Flujo de pantallas y requests existentes

### 1. Autenticación

Usar la sesión autenticada existente de Authentication. Sin token o con token inválido las rutas protegidas responden `401`. Esta guía no redefine registro/login ni almacena credenciales en frontend.

### 2. Mostrar avisos y decidir consentimiento

`GET /api/v1/consents/notices` es público y devuelve un array de avisos publicados y vigentes:

```json
[
  {
    "id": "<notice-version-uuid>",
    "purpose": "preliminary_assessment",
    "version": "<version-returned-by-server>",
    "content": "<texto-devuelto-por-el-servidor>",
    "effectiveAt": "<ISO-8601>"
  }
]
```

El frontend debe mostrar el texto real devuelto para esa finalidad. No construir aviso propio, no convertir la aceptación de otra finalidad en autorización y no asumir que tener token equivale a aceptar. Si el aviso falta, está vencido o el usuario rechaza, no ofrecer inicio.

Con sesión iniciada, `GET /api/v1/consents/me` consulta el estado:

```json
{
  "items": [
    {
      "purpose": "preliminary_assessment",
      "state": "not_decided",
      "currentNoticeVersion": "<version-or-null>",
      "changedAt": null
    }
  ]
}
```

Estados posibles observados en OpenAPI: `granted`, `declined`, `withdrawn`, `not_decided`, `renewal_required`. El GET puede incluir más finalidades; filtrar por el propósito necesario.

Registrar decisión explícita con `POST /api/v1/consents/me/decisions`:

```json
{
  "purpose": "preliminary_assessment",
  "noticeVersionId": "<id-del-aviso-exacto-mostrado>",
  "action": "granted",
  "idempotencyKey": "<uuid-nuevo-para-esta-operación>"
}
```

Acciones admitidas: `granted`, `declined`, `withdrawn`. Respuesta `201`:

```json
{
  "id": "<consent-event-uuid>",
  "purpose": "preliminary_assessment",
  "noticeVersionId": "<notice-version-uuid>",
  "action": "granted",
  "createdAt": "<ISO-8601>"
}
```

Al recibir `404`, el aviso no está disponible; volver a cargar avisos y estado, no reintentar indefinidamente el mismo ID. `409` significa conflicto al reutilizar idempotency key con contenido distinto. Tras `201`, consultar estado para confirmar lo vigente. Rechazo/withdrawal no se reemplazan desde el cliente mediante una bandera local.

### 3. Consultar catálogo y disponibilidad

`GET /api/v1/preliminary-assessments/info` requiere JWT y no body. Respuesta:

```json
{
  "assessmentAvailable": false,
  "mode": "structured_instrument",
  "instruments": []
}
```

Cuando hay instrumentos disponibles, cada item tiene `{instrumentId,instrumentVersionId,version,effectiveAt,questions}`. Cada pregunta trae `id`, `prompt`, `required`, `responseType`, `displayOrder` y el campo de tipo correspondiente (`minimum`/`maximum`, `options`, `maxLength`, etc.). El orden se fija en la versión del instrumento y se devuelve ascendente. Se debe renderizar solo la definición recibida y validar también en servidor. No fijar IDs/orden/preguntas en bundle frontend.

`assessmentAvailable` refleja el catálogo operativo actual, no aprobación clínica/jurídica ni selección formal de DASS-21. No mostrar una acción de inicio si el instrumento requerido no aparece.

### 4. Iniciar evaluación

Solo cuando hay consentimiento vigente y un instrumento disponible, enviar `POST /api/v1/preliminary-assessments`:

```json
{ "instrumentVersionId": "<uuid-exacto-devuelto-por-info>" }
```

`accountId` adicional viola el esquema estricto. Respuesta `201` es un recurso `AssessmentResponse`, por ejemplo:

```json
{
  "id": "<assessment-uuid>",
  "assessmentType": "structured_instrument",
  "mode": "structured_instrument",
  "status": "in_progress",
  "instrumentVersionId": "<instrument-version-uuid>",
  "createdAt": "<ISO-8601>",
  "startedAt": "<ISO-8601>",
  "completedAt": null,
  "withdrawnAt": null,
  "updatedAt": "<ISO-8601>",
  "responses": []
}
```

`403` consentimiento ausente/rechazado/retirado/no vigente. `409` instrumento no disponible o conflicto de estado. Si vuelve 403, refrescar consentimiento y avisos; no repetir automáticamente el inicio.

### 5. Presentar instrucciones y reactivos

La ruta `GET /api/v1/preliminary-assessments/:id/form` devuelve las preguntas ordenadas de la versión fijada y el progreso ya guardado. Solo funciona para una evaluación abierta del propietario con consentimiento vigente vinculado a esa versión. Los instrumentos publicados después de la migración 0007 deben tener `displayOrder` completo, único y contiguo desde 1. Las versiones históricas sin orden explícito permanecen intactas pero no se ofrecen para iniciar ni presentar; se requiere una nueva versión aprobada para sustituirlas.

No mostrar reactivos DASS-21 hasta que una versión exacta haya sido elegida y aprobada para el uso previsto. No copiar/reformular textos de otra fuente ni inferir el contenido desde el número de pregunta.

### 6. Guardar respuesta y progreso

Por respuesta, `POST /api/v1/preliminary-assessments/:id/responses`. Body admite las variantes definidas por el instrumento. Ejemplo únicamente de forma para una pregunta numérica sintética:

```json
{
  "questionId": "<question-uuid-recibido-del-servidor>",
  "answer": { "type": "number", "value": 2 }
}
```

Para omitir/limpiar una respuesta pendiente, el esquema permite `answer: null`:

```json
{
  "questionId": "<question-uuid-recibido-del-servidor>",
  "answer": null
}
```

Para opciones se envía el ID exacto recibido; para opción múltiple, `optionIds`; el servidor rechaza valores fuera del dominio de pregunta. Body estricto: no incluir `accountId`, estado ni versión elegida por cliente.

Respuesta `200`:

```json
{
  "assessmentId": "<assessment-uuid>",
  "instrumentVersionId": "<instrument-version-uuid>",
  "questionId": "<question-uuid>",
  "status": "answered",
  "answer": { "type": "number", "value": 2 },
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}
```

Enviar de nuevo la misma pregunta actualiza su respuesta (upsert), no añade una segunda respuesta vigente. No hay idempotency key para este endpoint; al reintentar tras timeout, consultar `GET /:id` y reconciliar con la respuesta actual. No almacenar texto de respuestas en analytics, crash reports o logs de frontend.

Recuperar progreso con `GET /api/v1/preliminary-assessments/:id` o con el formulario versionado `GET /api/v1/preliminary-assessments/:id/form`. Para listar historial, usar `GET /api/v1/preliminary-assessments`. En evaluaciones abiertas el listado conserva metadatos, pero omite `responses` si el aviso ya no coincide o el servicio de consentimiento falla; `GET /:id` y `/form` devuelven `403` hasta completar la decisión y reautorización explícitas descritas abajo.

```json
{
  "id": "<assessment-uuid>",
  "assessmentType": "structured_instrument",
  "mode": "structured_instrument",
  "status": "in_progress",
  "instrumentVersionId": "<instrument-version-uuid>",
  "createdAt": "<ISO-8601>",
  "startedAt": "<ISO-8601>",
  "completedAt": null,
  "withdrawnAt": null,
  "updatedAt": "<ISO-8601>",
  "responses": [
    {
      "assessmentId": "<assessment-uuid>",
      "instrumentVersionId": "<instrument-version-uuid>",
      "questionId": "<question-uuid>",
      "status": "answered",
      "answer": { "type": "number", "value": 2 },
      "createdAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>"
    }
  ]
}
```

El array es real y contiene respuestas actuales; la forma completa de cada miembro es el objeto anterior. GET propio devuelve información sensible del propietario. No incluir respuesta en una notificación ni en telemetría. Ownership ajeno o ID inexistente devuelve `404`, para no confirmar la existencia del registro.

### 7. Pausar, reanudar o retirar

`POST /:id/pause`, `/resume` y `/withdraw` aceptan body omitido o `{}` y devuelven el recurso `AssessmentResponse`. `GET /:id/form` devuelve el snapshot ordenado y las respuestas guardadas para continuar una evaluación abierta.

- `pause`: usar cuando el participante solicita pausar; no borra datos.
- `resume`: exige consentimiento vigente y versión coincidente. Ante `403`, consultar avisos y estado de consentimiento; nunca asumir aceptación automática.
- Si se publicó otro aviso, el frontend debe mostrarlo y registrar una decisión explícita con `POST /api/v1/consents/me/decisions`. Solo después puede llamar `POST /api/v1/preliminary-assessments/:id/reauthorize` con `{}`. Esa ruta asocia el assessment abierto a la versión actualmente autorizada; no registra consentimiento, no cambia su estado ni recupera evaluaciones retiradas/completadas. Luego obtener nuevamente `GET /:id/form`; si está pausada, llamar `POST /:id/resume`.
- `withdraw`: termina la participación de esa evaluación. No implica supresión de respuestas ya guardadas; la comunicación debe ser neutral y no prometer borrado.
- Estados del servidor: `in_progress`, `paused`, `completed`, `withdrawn`, `expired`. El cliente no los escribe directamente.
- `409` representa transición/estado incompatible, no reintentar sin volver a consultar el estado.

### 8. Completar y confirmar

`POST /api/v1/preliminary-assessments/:id/complete` body omitido o `{}`. Si falta una respuesta obligatoria, `409`; no marcar finalizada en frontend por cuenta propia. Éxito `200`:

```json
{
  "assessment": {
    "id": "<assessment-uuid>",
    "assessmentType": "structured_instrument",
    "mode": "structured_instrument",
    "status": "completed",
    "instrumentVersionId": "<instrument-version-uuid>",
    "createdAt": "<ISO-8601>",
    "startedAt": "<ISO-8601>",
    "completedAt": "<ISO-8601>",
    "withdrawnAt": null,
    "updatedAt": "<ISO-8601>",
    "responses": [
      {
        "assessmentId": "<assessment-uuid>",
        "instrumentVersionId": "<instrument-version-uuid>",
        "questionId": "<question-uuid>",
        "status": "answered",
        "answer": { "type": "number", "value": 2 },
        "createdAt": "<ISO-8601>",
        "updatedAt": "<ISO-8601>"
      }
    ]
  },
  "result": {
    "schemaVersion": "1.0",
    "assessmentId": "<assessment-uuid>",
    "instrumentVersionId": "<uuid-o-null>",
    "calculatedAt": "<ISO-8601>",
    "instrumentScores": { "status": "not_available", "reason": "no_approved_scoring_rules" },
    "interpretation": { "status": "not_available", "reason": "no_approved_scoring_rules" },
    "attentionPriority": { "status": "not_available", "reason": "no_approved_scoring_rules" },
    "safetyState": { "status": "not_available", "reason": "not_assessed" }
  }
}
```

Las respuestas numéricas son placeholders de contrato y no representan preguntas reales. La UI puede confirmar que la evaluación se recibió/completó y mostrar texto de orientación aprobado por responsables, pero no puntajes, etiquetas de nivel ni diagnósticos. La ruta no activa el motor interno.

`GET /:id/result` devuelve el mismo recurso de resultado público, sin puntajes. No existe endpoint para leer el objeto interno DASS-21.

## Tratamiento de errores y reintentos

| HTTP | Uso observado | Acción de UI |
|---|---|---|
| 400 | UUID, query o body Zod inválido; ID/pregunta incompatible. | Error de campo sin conservar el texto de respuesta en telemetry; permitir corregir. |
| 401 | JWT ausente/expirado/inválido. | Renovar sesión por el flujo auth existente o pedir inicio de sesión. No repetir POST automáticamente antes de recuperar sesión. |
| 403 | Consentimiento actual requerido. | Detener escritura, refrescar aviso/estado, mostrar decisión explícita. |
| 404 | Assessment/result inexistente o no propio. | Pantalla no encontrada genérica; no buscar IDs alternativos. |
| 409 | Instrumento no disponible, transición inválida, respuestas incompletas o carrera. | Leer estado/catálogo, preservar input local solo conforme a política aprobada y permitir acción explícita. |
| 500 | Fallo interno sanitizado. | Mensaje neutral y reintento solo tras consultar estado; no duplicar automáticamente alta/decisión. |

No mostrar stack, SQL, nombres de constraint o datos de autorización. El servidor no documenta códigos de dominio separados para cada caso: usar HTTP y el mensaje genérico, no programar lógica con texto exacto.

## Accesibilidad y privacidad de la interfaz

- Formularios con etiquetas accesibles, foco visible, navegación por teclado y anuncios de error/guardado compatibles con lector de pantalla.
- No usar color como único indicador de pregunta respondida, error, estado o progreso.
- Confirmar cambios de respuesta cuando un participante navega de vuelta; no exigir velocidad ni crear presión no aprobada.
- Proteger pantalla ante pérdida de foco/dispositivo compartido según diseño de seguridad; no guardar respuestas en localStorage persistente por defecto.
- Progreso debe basarse en el esquema cargado y estado del servidor. No insinuar progreso clínico ni nivel de riesgo.
- Incluir una vía de salida/pausa acordada con responsables antes de pilotear; no inventar consejo de salud o emergencia.
- No registrar prompts, preguntas respondidas, tokens JWT, contenido de respuestas ni scores en telemetría.

## Matriz de bloqueo frontend

| Necesidad de interfaz | Estado | Razón / condición para avanzar |
|---|---|---|
| Pantalla de consentimiento por finalidad | IMPLEMENTADO | Aviso/decisión APIs existen; contenido válido debe estar publicado y aprobado por humanos en el ambiente correspondiente. |
| Selector de instrumento | IMPLEMENTADO técnicamente | Mostrar solo catálogo actual; no hay DASS real seleccionado/cargado. |
| Formulario DASS-21 | BLOQUEADO | Sin traducción seleccionada, derechos, aprobación profesional ni orden de reactivos. |
| Guardado y recuperación | IMPLEMENTADO técnicamente | `GET /:id/form` devuelve preguntas en orden versionado y respuestas guardadas, con control de propietario y consentimiento. |
| Renovación de aviso en evaluación abierta | IMPLEMENTADO técnicamente | Tras una decisión explícita para el aviso actual, `POST /:id/reauthorize` actualiza la referencia del assessment abierto; no acepta consentimientos ni reactiva estados terminales. |
| Confirmación de finalización sin scores | IMPLEMENTADO | Mantenerla neutral; `result` público muestra `not_available`. |
| Mostrar puntajes DASS al estudiante | BLOQUEADO | No permitido por contrato/decisión actual; UNSW además advierte contra provisión automática al respondiente. |
| Panel de investigación/profesional | BLOQUEADO | No hay RBAC, alcance, lectura score ni auditoría de acceso aprobados. |

## Referencias

- Endpoints y schemas en `src/modules/consent/interfaces/rest/openapi.ts`, `src/modules/consent/interfaces/rest/validation/consent-schemas.ts` y `src/modules/preliminary-assessment/interfaces/rest/openapi.ts`.
- [Plan de activación y matriz de traducciones](sprint-5b5-dass21-activation-plan.md).
- [UNSW Spanish translations](https://www2.psy.unsw.edu.au/dass/Spanish/Spanish.htm), [UNSW FAQ](https://dass.psy.unsw.edu.au/DASSFAQ.htm), [forma DASS-21](https://dass.psy.unsw.edu.au/Download%20files/Dass21.pdf).

## Historial

- Sprint 5B.5: documentado contrato actual; sin cambios a rutas, OpenAPI, dominio ni base de datos.
