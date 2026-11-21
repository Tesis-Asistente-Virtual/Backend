# PreliminaryAssessment

Este bounded context implementa el dominio, persistencia y API de evaluaciones preliminares. No implica que exista un instrumento clínico aprobado o disponible en una base de datos, y el resultado actual mantiene puntuaciones e interpretaciones como `not_available`.

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
