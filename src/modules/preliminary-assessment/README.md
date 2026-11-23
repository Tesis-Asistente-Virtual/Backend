# PreliminaryAssessment

Este bounded context implementa el dominio, persistencia y API de evaluaciones preliminares. No implica que exista un instrumento clínico aprobado o disponible en una base de datos, y el resultado actual mantiene puntuaciones e interpretaciones como `not_available`.

## Preparación técnica DASS-21

El bounded context contiene el motor puro y determinista `dass21-score-1.0`, contratos de mapeo UUID↔número de ítem versionados y congelables, persistencia interna separada de puntajes, y el caso de uso `ScoreCompletedDass21Assessment`. El servicio valida propiedad, evaluación completada, consentimiento vigente, instrumento disponible, mapeo congelado y respuestas completas; persiste de forma idempotente con revalidación transaccional. Está disponible como infraestructura interna, pero **no está registrado en el router, composición productiva, finalización HTTP, jobs, conversaciones ni automatizaciones**.

La migración aditiva 0006 y tablas de infraestructura no implican que haya contenido real. No se ha cargado una traducción española ni un instrumento DASS-21 real aprobado; los ejemplos de pruebas son genéricos y sintéticos. No seleccionar, publicar ni ofrecer el instrumento hasta completar revisión profesional, psicométrica, jurídica y ética. La matriz y los bloqueos de activación están en [docs/sprint-5b5-dass21-activation-plan.md](../../../docs/sprint-5b5-dass21-activation-plan.md).

El endpoint público `GET /api/v1/preliminary-assessments/:id/result` sigue leyendo únicamente `assessment_results`, cuyo esquema requiere `not_available` para puntuaciones e interpretación. No consulta ni revela la tabla psicométrica interna. No existe puerto ni endpoint de lectura de puntajes para investigadores o profesionales. No se deben exponer puntuaciones al estudiante.

El formulario estructurado se recupera mediante `GET /api/v1/preliminary-assessments/:id/form`. Devuelve la definición de preguntas de la versión fijada con `displayOrder` estable, más las respuestas actuales, solo al propietario y mientras la evaluación esté abierta y el consentimiento vigente coincida. `POST /:id/reauthorize` permite vincular una evaluación abierta a una nueva versión de aviso únicamente después de una decisión `granted` explícita; no acepta consentimiento ni revive evaluaciones cerradas.

La migración aditiva 0007 incorpora `display_order`, unicidad por versión y validación de orden completo al aprobar. No se ejecutó como parte de Sprint 5B.6. Filas históricas conservan `display_order = NULL`; no se ordenan por UUID ni se presentan hasta que una nueva versión ordenada sea preparada y aprobada. Contratos y flujo de interfaz están en [docs/sprint-5b6-assessment-form.md](../../../docs/sprint-5b6-assessment-form.md) y [docs/sprint-5b5-frontend-assessment-guide.md](../../../docs/sprint-5b5-frontend-assessment-guide.md).

## Consentimiento de `preliminary_assessment`

El inicio consulta el consentimiento actual en aplicación y lo revalida al crear la evaluación. En las respuestas, reanudación y finalización, el adaptador PostgreSQL vuelve a comprobar el aviso y la última decisión dentro de la transacción de escritura. La autorización exige:

- Aviso de la finalidad `preliminary_assessment` en estado `published` y efectivo al momento de la operación.
- Evento más reciente `granted` para la misma cuenta y finalidad.
- Coincidencia exacta entre la versión del evento, el aviso actual y el aviso asociado a la evaluación.

La ausencia, retiro, rechazo o sustitución de aviso deniega la operación. La transacción se revierte ante la denegación; no se cambia estado ni se crea respuesta o resultado parcial.

## Orden de locks

Las operaciones protegidas toman locks en el orden `auth_accounts FOR SHARE` → aviso vigente `FOR SHARE` → fila de evaluación (cuando la operación la bloquea o actualiza). Las decisiones de Consent toman `auth_accounts FOR UPDATE` antes del aviso. Esto serializa retiros frente a escrituras y evita invertir el orden de cuenta/aviso.

El lock compartido del aviso mantiene su versión vigente hasta que la escritura hace commit. Si una sustitución obtiene primero el lock, la revalidación ve que el aviso esperado dejó de estar publicado o ya no coincide con el último grant y falla cerrada. Si la operación protegida obtiene primero el lock, completa antes de la sustitución.

No se mantiene una transacción abierta durante llamadas a proveedores; PreliminaryAssessment no llama a OpenAI. Las lecturas de datos históricos y la política de retención tras el retiro siguen siendo decisiones jurídicas y éticas pendientes.

## Cobertura

- Pruebas unitarias: errores de consentimiento en las fronteras de reanudación y finalización, y ausencia de escrituras/reportes de éxito.
- Pruebas PostgreSQL: aviso vigente, reemplazo previo y sustitución concurrente frente a reanudación/finalización; se comprueba estado y ausencia de resultado.
- Las integraciones usan únicamente `TEST_DATABASE_URL`, validada por `tests/integration/test-database.ts` para una instancia local llamada `tesis_test_db`. No existe fallback a `DATABASE_URL`.

## Límites

Consent requiere aprobación versionada; este módulo no crea avisos. La implementación técnica no constituye revisión legal, ética ni validación clínica. No se incluyen instrumentos clínicos nuevos, reglas de puntuación ni diagnósticos.
