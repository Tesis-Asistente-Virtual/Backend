# Sprint 8A.3 — resolución de respuestas DASS-21

## Estado

La resolución ya está implementada en el caso de uso interno de puntuación. La respuesta persistida sigue guardando `optionId`; el servidor obtiene el valor únicamente de la opción que pertenece a la pregunta de la versión instrumental fijada.

Este cambio no carga ni habilita la candidata española de 8A.2, no compone scoring con la finalización HTTP y no modifica `/result`. DASS-21 continúa sin estar disponible para estudiantes.

## Procedencia del valor

Las opciones de `InstrumentQuestion` pueden tener ahora `scoringValue` opcional, entero entre 0 y 3. Es metadata de la definición versionada que mantiene el catálogo, no un campo de `AssessmentAnswer` ni del request REST. El body de respuesta sigue siendo `{ "type": "single_choice", "optionId": "..." }`; el schema estricto rechaza `scoringValue` enviado por el cliente.

Para que una versión se pueda usar por el motor DASS-21, cada pregunta referenciada por el mapeo debe:

- pertenecer a la misma `instrumentVersionId` y mapearse una sola vez a un ítem;
- ser obligatoria y ocupar el `displayOrder` correspondiente a su número de ítem;
- ser numérica con rango 0–3, como en los fixtures anteriores, o `single_choice` con exactamente cuatro opciones cuyos valores internos sean distintos y cubran `{0,1,2,3}`.

Al puntuar una respuesta `single_choice`, el motor busca el `optionId` dentro de las opciones de esa pregunta y utiliza el `scoringValue` de la definición cargada desde el catálogo. No interpreta `label`, no acepta un número en el objeto de respuesta y no busca opciones globalmente. Un ID cruzado, respuesta duplicada, opción sin valor o mapeo incompatible falla cerrado. Después se conserva el scoring existente `dass21-score-1.0` y la conversión de puntajes equivalente.

Las respuestas `number` de instrumentos anteriores continúan funcionando, siempre que el instrumento y el mapeo cumplan las validaciones previas. No se reinterpretan respuestas almacenadas históricamente ni se migra su contenido.

## Exposición REST

El campo `scoringValue` es interno: el formulario de una evaluación y `GET /info` proyectan las opciones como `{id,label}`. El schema público OpenAPI tampoco describe `scoringValue`. El frontend envía exclusivamente el `optionId` visible. El endpoint público `/result` conserva el contrato sin puntajes ni categorías.

## Persistencia y migraciones

No se requiere migración: las definiciones de preguntas/opciones se guardan dentro del JSON existente y `optionId` se conserva como respuesta. La modificación del schema Zod es aditiva para definiciones antiguas, donde el campo sigue ausente. Una versión de selección múltiple sin mapa interno completo no se puede puntuar como DASS-21. La definición aprobada debe permanecer inmutable y el caso de uso usa la versión exacta fijada a la evaluación.

## Pruebas

Las pruebas unitarias utilizan únicamente definiciones y respuestas sintéticas. Cubren valores 0, 1, 2 y 3 aplicados a los 21 ítems, opciones cruzadas, payload con score manipulado, mapping incompleto/duplicado/fuera de orden, opciones sin valor o con valores repetidos/fuera de rango, respuesta duplicada, proyección sin metadata interna y compatibilidad con el scoring numérico existente.

## Bloqueos para publicación

- El texto y edición exactos de la versión española candidata deben cotejarse con su fuente y revisión profesional documentada.
- El instrumento real debe cargarse como una nueva versión no disponible hasta completar aprobaciones y verificación de la asignación pregunta ↔ número ↔ dimensión ↔ opción/valor.
- Antes de cualquier activación se mantienen pendientes las políticas de consentimiento, acceso a puntajes, retención y validación para la población de estudio.
- No se entrega score ni categoría al estudiante, y la función interna de scoring no se activa automáticamente.
