# Sprint 5B.4 — Orquestación interna de puntuación DASS-21

## Alcance y estado

Se añadió `ScoreCompletedDass21Assessment`, un caso de uso interno que coordina la evaluación preliminar existente, el catálogo de instrumentos aprobados, el mapa DASS-21 congelado, el motor determinista `dass21-score-1.0` y el repositorio interno de puntuaciones.

El servicio **no está registrado** en el router, el composition root, conversaciones, jobs ni automatizaciones. No existe endpoint nuevo y `GET /api/v1/preliminary-assessments/:id/result` conserva su DTO público sin puntuaciones. El incremento no habilita DASS-21 para participantes reales.

## Contrato interno

El invocador interno llama:

```ts
execute(accountId, { assessmentId, mappingVersion })
```

`accountId` debe provenir de una frontera de aplicación confiable; no se acepta en el comando y el repositorio vuelve a comprobar ownership. `mappingVersion` es una selección explícita de configuración interna, no una opción REST del participante. El resultado interno contiene `schemaVersion`, `status`, `assessmentId`, `accountId`, identificadores de instrumento/versión/mapa, versiones de mapeo y motor, `calculatedAt` y puntuaciones raw/equivalent de depression, anxiety y stress. No contiene categorías de severidad ni diagnósticos.

## Flujo y autorizaciones

1. Valida la identidad y el comando estrictos.
2. Comprueba consentimiento vigente para `preliminary_assessment` antes de cargar la evaluación; errores del autorizador se convierten en denegación segura.
3. Recupera la evaluación mediante `findByIdForOwner` y exige estado `completed`, modo estructurado y versión de instrumento asociada.
4. Exige que la versión de consentimiento guardada en la evaluación coincida con la vigente.
5. Carga la versión aprobada, autorizada y vigente por su ID exacto.
6. Carga el mapa congelado por versión exacta de instrumento y `mappingVersion`; el dominio valida cobertura completa, UUID, unicidad y versión.
7. Revalida consentimiento antes de procesar las respuestas en memoria.
8. El dominio verifica las 21 respuestas completadas y puntúa determinísticamente; no hay llamadas externas.
9. El repositorio de puntajes abre una transacción breve, toma los locks en el orden existente (cuenta → aviso vigente → evaluación → mapa), vuelve a verificar consentimiento, decisión más reciente, propiedad, estado y versión, y persiste el puntaje interno.

El cálculo ocurre fuera de la transacción de escritura para mantenerla breve. Esto es seguro bajo el contrato actual porque las respuestas solo se editan cuando la evaluación está `in_progress` y el trigger PostgreSQL impide cambios una vez completada. La transacción final ordena el guardado frente a retiro/sustitución; si el retiro gana, no se inserta el puntaje. Si el guardado gana, su escritura queda antes del retiro confirmado. Un retiro posterior no borra el puntaje histórico automáticamente: retención y supresión requieren política aprobada.

## Reintentos y concurrencia

El repositorio devuelve la fila ya persistida cuando un reintento calcula las mismas dimensiones e identidad de instrumento, mapa, versión y motor. Se conserva el `calculatedAt` original. Si el cálculo/versiones no coinciden, responde con conflicto tipado (`result_conflict`) sin reemplazar el registro. El índice único mantiene una puntuación por evaluación. Dos ejecuciones concurrentes se serializan por el bloqueo de la evaluación y la restricción única; la integración prueba el orden concurrente de puntuación frente al retiro.

## Archivos y pruebas

- `src/modules/preliminary-assessment/application/internal/command-services/score-completed-dass21-assessment.ts`: nuevo orquestador interno.
- `src/modules/preliminary-assessment/domain/repositories/dass21-assessment-score-repository.ts`: el puerto ahora devuelve la puntuación persistida para representar reintentos idempotentes.
- `src/modules/preliminary-assessment/infrastructure/persistence/drizzle-dass21-assessment-score-repository.ts`: devuelve el registro insertado o el previo si el contenido calculado coincide; preserva conflicto ante cambios.
- `tests/modules/preliminary-assessment/score-completed-dass21-assessment.test.ts`: dobles para éxito, orden de autorización, rechazo de identidad/estado/instrumento/mapa, consentimiento ausente/revocado/fallido, respuestas insuficientes o duplicadas y fallo de persistencia.
- `tests/integration/dass21-postgres.integration.test.ts`: el flujo completo usa ahora el caso de uso con Consent, mapeo, instrumento, evaluación y PostgreSQL reales de prueba; también repite la ejecución para comprobar estabilidad/idempotencia y comprueba que `/result` no filtra datos internos.

Los fixtures de aprobación/mapa de integración son únicamente sintéticos y aislados en `tesis_test_db`; no constituyen aprobación instrumental real. Las respuestas e ítems son genéricos, no los enunciados DASS.

## Persistencia y cambios de base

No se modificaron esquema ni migraciones. El caso de uso reutiliza 0006 y las tablas/constraints que ya existen. No se ejecutaron migraciones.

## Activación futura

Antes de componer este servicio en un flujo de evaluación se requiere seleccionar y validar profesionalmente una traducción exacta en español, aprobar sus condiciones de uso digital, crear y congelar el mapeo UUID↔ítem para esa versión, verificar el motor con el responsable psicométrico y acordar consentimiento, privacidad, acceso interno, retención, exportación y supresión con revisión ética/jurídica. La exposición de puntajes al participante requiere una decisión independiente; no forma parte de este servicio.

## Verificación

`npm run typecheck`, `npm run build` y `npm test` finalizaron correctamente; la suite unitaria aprobó 281 pruebas. También pasó TypeScript directo sobre el nuevo test unitario y el archivo de integración. La integración PostgreSQL no se ejecutó en este entorno porque `TEST_DATABASE_URL` no está configurada. Requiere conexión local apuntando exactamente a `tesis_test_db`, con 0006 previamente aplicada. Este incremento no conecta a bases ni ejecuta migraciones automáticamente.
