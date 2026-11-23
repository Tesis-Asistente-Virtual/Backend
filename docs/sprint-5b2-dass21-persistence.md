# Sprint 5B.2 — preparación de mapeo y persistencia DASS-21

## Alcance y estado

Se prepararon contratos de dominio y una migración Drizzle aditiva para mapear preguntas a números DASS-21 por versión y almacenar subescalas calculadas en una tabla interna separada. No se cargaron ítems, traducciones, instrumentos ni mapas; no se aprobó ni publicó ningún instrumento. La migración `0006_bizarre_inhumans.sql` **no fue ejecutada** en ninguna base.

El motor de Sprint 5B.1 (`dass21-score-1.0`) permanece sin cambios. Ningún caso de uso o ruta productiva lo invoca. `GET /api/v1/preliminary-assessments/:id/result` y la respuesta de finalización conservan el resultado público `schemaVersion: 1.0`, `instrumentScores.status: not_available`; las puntuaciones psicométricas internas no se consultan ni se exponen por REST.

## Modelo

### Mapeo UUID a ítem

- `assessment_scoring_mapping_versions` identifica `mappingId`, `instrumentId`, `instrumentVersionId`, `mappingVersion` y estado técnico `draft|frozen`.
- `assessment_scoring_item_mappings` guarda cada par `questionId` UUID / `itemNumber` 1–21.
- Las FK compuestas obligan a que el ítem pertenezca a la versión del instrumento indicada. PK/UNIQUE impiden repetir pregunta o número dentro del mismo mapa.
- La validación de dominio exige 21 entradas, cobertura exacta 1–21, preguntas requeridas numéricas 0–3 y asociación con una versión disponible exacta. No usa el orden devuelto por PostgreSQL.
- El trigger de la migración permite congelar únicamente un mapa completo vinculado a un instrumento aprobado y autorizado; al congelarse, el mapa y sus entradas son inmutables. Un cambio futuro exige nueva `mappingVersion` y, según corresponda, nueva versión instrumental.

El estado `frozen` significa integridad técnica congelada; no equivale por sí solo a aprobación psicométrica, ética o jurídica.

### Puntajes internos

`assessment_psychometric_scores` persiste una fila inmutable por evaluación con estado `calculated`, `assessmentId`, `accountId`, instrumento y versión, `mappingId`/`mappingVersion`, `scoringVersion`, `schemaVersion`, timestamp y pares `rawScore`/`equivalentScore` para depression, anxiety y stress. CHECKs limitan raw a 0–21 y exigen `equivalentScore = rawScore * 2`. No hay columnas de categoría, diagnóstico, prioridad o seguridad.

El trigger rechaza UPDATE y DELETE directos del puntaje; la eliminación en cascada desde la evaluación/cuenta sigue el comportamiento de privacidad ya definido por las FK. Debe verificarse el comportamiento concreto de cascada en integración PostgreSQL antes de desplegar.

Las FK compuestas vinculan evaluación, propietario, versión instrumental y mapa. El trigger exige evaluación completada, mapa congelado y consentimiento `preliminary_assessment` vigente al momento de escritura. El repositorio vuelve a comprobar la autorización dentro de una transacción con el orden de locks existente: cuenta → aviso vigente → evaluación → mapa. Una revocación confirmada primero impide la escritura; si la escritura protegida obtuvo primero sus locks, queda ordenada antes del retiro.

## Acceso y límites

- El repositorio interno de escritura se añadió, pero no está registrado en composición ni conectado a endpoints/casos de uso. No se añadió un puerto de consulta de puntajes.
- El endpoint público `/result` sigue leyendo solo `assessment_results`; no consulta `assessment_psychometric_scores`. La prueba de regresión confirma que su transformador no incluye campos de puntajes, versiones internas o mapeo.
- No se creó endpoint para investigadores. Diseñar acceso requerirá rol, alcance de estudio, autorización institucional, auditoría y revisión de quién recibe los resultados. Un JWT de estudiante no confiere permiso de investigación.
- Los resultados heredados no se actualizan: permanecen en `assessment_results` con `not_available`. Los nuevos puntajes internos, cuando se habiliten, tendrán su fila propia e inmutable.
- El acceso después de retirar consentimiento, retención/supresión y exportación requieren política aprobada. El repositorio solo permite una nueva escritura con autorización vigente; no implementa lectura histórica.

## Archivos y migración

- `src/modules/preliminary-assessment/domain/model/dass21-question-mapping.ts`: contrato, validación por versión y transición draft→frozen.
- `src/modules/preliminary-assessment/domain/model/dass21-assessment-score.ts`: resultado interno y autorización previa a persistencia.
- `src/modules/preliminary-assessment/domain/repositories/dass21-question-mapping-repository.ts` y `dass21-assessment-score-repository.ts`: puertos internos.
- `src/modules/preliminary-assessment/infrastructure/persistence/schema.ts`: definiciones Drizzle.
- `drizzle/0006_bizarre_inhumans.sql` y `drizzle/meta/0006_snapshot.json`: migración generada aditiva. Se añadieron triggers SQL de congelación/inmutabilidad y de validación/consentimiento para puntajes. Se conservan migraciones 0000–0005.
- Dos pruebas de dominio nuevas cubren mapeo, salida interna, consentimiento/propiedad en la guarda pura y no filtración a respuesta pública.

La migración introduce solo tablas/constraints/índices/funciones/triggers y una clave UNIQUE compuesta en `preliminary_assessments`; no modifica ni elimina datos existentes. Fue generada por `npm run db:generate`, no aplicada. Antes de aplicarla en una base autorizada se requiere revisar SQL, validar migración en `tesis_test_db` aislada y aprobar el proceso normal de despliegue.

## Pendiente antes de cargar la versión española

1. Psicología/investigación debe seleccionar la traducción exacta, documentar traductor/fuente, periodo de referencia y adecuación a la población objetivo; no se incluyen ítems en código ni fixtures.
2. Revisar licencia, aplicación digital, devolución de resultados y flujo de investigación. La versión publicada por UNSW no selecciona automáticamente una traducción para esta tesis.
3. Aprobar la versión como instrumento y vincular cada UUID real al número correspondiente mediante un mapa completo revisado; nunca derivar el mapeo por orden de filas.
4. Diseñar el caso de uso que complete respuestas, evalúe consentimiento y guarde el puntaje. Hoy el repositorio no forma parte de la composición.
5. Definir autorización para lectura de puntajes. No se habilita exposición al estudiante ni a investigadores en este incremento.
6. Preparar pruebas de integración PostgreSQL para constraints, triggers, retiro concurrente, idempotencia y FK de propietario antes de desplegar la migración.
7. Definir retención, acceso, exportación y supresión con asesoría jurídica/ética. No se retienen datos de modo permanente por esta decisión técnica.

## LongitudinalMonitoring

No se integra DASS-21 con `LongitudinalMonitoring`. No se copian puntajes a sesiones o mediciones longitudinales ni se generan tendencias. Un incremento separado debe resolver consentimiento específico `longitudinal_monitoring`, comparabilidad de versiones, ventanas temporales, acceso y retención; las finalidades no son intercambiables.
