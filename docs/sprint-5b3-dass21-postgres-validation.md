# Sprint 5B.3 — Validación PostgreSQL de la infraestructura DASS-21

## Propósito y alcance

Esta etapa añade pruebas de integración para las estructuras internas preparadas en Sprint 5B.2. Se cubren el mapeo versionado de preguntas, sus restricciones de PostgreSQL, la persistencia interna de puntuaciones, autorización por cuenta y consentimiento, e invariancia del endpoint público `/result`.

No se habilita el instrumento DASS-21 real, no se cargan preguntas oficiales ni traducciones, no se publican puntuaciones al estudiante y no se integra el cálculo con el flujo de evaluación. Los fixtures usan preguntas numéricas genéricas y ficticias, identificadas como infraestructura sintética de pruebas. Cualquier metadato de aprobación que requiera la restricción existente es exclusivamente un fixture de `tesis_test_db`; no representa aprobación profesional, legal o psicométrica.

## Casos cubiertos

El archivo `tests/integration/dass21-postgres.integration.test.ts` verifica:

- Persistencia y lectura del mapa de exactamente 21 referencias UUID↔número, con orden estable del 1 al 21.
- Rechazo de mapas incompletos o con números duplicados en el límite de dominio.
- Unicidad de versión del mapa; inmutabilidad del mapa y de sus elementos congelados.
- FK de la referencia pregunta-versión.
- Persistencia de las tres subescalas, vínculo a instrumento, versión, mapa y motor `dass21-score-1.0`; equivalentes iguales a `rawScore × 2`.
- Idempotencia: el mismo resultado interno se puede reintentar sin duplicar filas; una carga distinta no debe reemplazar el resultado.
- Rechazo por propietario incorrecto, evaluación no completada, falta de consentimiento, rechazo y retiro.
- Orden transaccional entre escritura del puntaje y retiro concurrente: el retiro debe quedar como última decisión, y la escritura solo puede completarse si ganó su orden transaccional.
- El endpoint `GET /api/v1/preliminary-assessments/:id/result` sigue respondiendo con campos no disponibles y no expone puntuaciones ni metadatos internos, aun si existe una fila en `assessment_psychometric_scores`.

Las pruebas de contrato de Sprint 5B.2 ya cubren otros rechazos de entrada y versiones en el dominio. La integración verifica además las constraints ejecutables reales de PostgreSQL. La prueba de concurrencia es una carrera entre transacciones reales de escritura y consentimiento; no usa mocks ni esperas temporizadas.

## Restricciones de base de datos consideradas

La migración `drizzle/0006_bizarre_inhumans.sql` define, entre otras:

- Unicidad `(instrument_version_id, mapping_version)` y `(mapping_id, item_number)`.
- FK compuesta desde cada elemento del mapa a su mapa y a la pregunta de la misma versión del instrumento.
- La congelación exige instrumento aprobado/licenciado en el fixture, 21 preguntas compatibles, 21 referencias distintas y cobertura 1–21.
- Triggers que impiden editar o borrar mapas congelados y elementos asociados.
- FK compuestas de puntajes a evaluación-propietario, evaluación-versión, instrumento y mapa.
- Puntaje único por evaluación y checks para valores raw 0–21 y equivalentes exactamente ×2.
- Trigger que exige evaluación completada, consentimiento `preliminary_assessment` vigente y decisión `granted`, así como mapa congelado coincidente; los puntajes no son editables ni borrables directamente.

Las pruebas no reemplazan una revisión del SQL desplegado. Requieren que la migración 0006 ya esté aplicada en la base de prueba antes de ejecutarlas.

## Aislamiento y ejecución

La conexión se realiza únicamente mediante `connectTestDatabase()` en `tests/integration/test-database.ts`. Esa guarda no consulta `DATABASE_URL`: exige `TEST_DATABASE_URL`, protocolo PostgreSQL, host loopback, nombre exacto `tesis_test_db` y verifica la identidad de la base y la dirección del servidor después de conectar.

En el entorno de esta ejecución `TEST_DATABASE_URL` no está configurada. Por ello no se abrió conexión, no se ejecutó SQL, migración ni suite PostgreSQL, y no se usó `tesis_demo_db`, `tesis_db` ni un fallback.

Para ejecutar localmente en PowerShell, el operador debe proporcionar `TEST_DATABASE_URL` solo en el proceso actual con una conexión local dirigida exactamente a `tesis_test_db`, y luego correr:

```powershell
npm run test:integration -- --run tests/integration/dass21-postgres.integration.test.ts
```

Vitest no aplica migraciones. Si 0006 no se ha aplicado a `tesis_test_db`, las pruebas deben permanecer pendientes; aplicar migraciones es una operación separada y no forma parte de este incremento. No apuntar `TEST_DATABASE_URL` a `tesis_demo_db` ni a `tesis_db`.

El fixture aprobado sintético del instrumento y el mapa congelado se conservan para reuso dentro de `tesis_test_db`, ya que los triggers los hacen inmutables. Las cuentas, evaluaciones, respuestas, eventos de consentimiento y puntajes creados por las pruebas se limpian por cascada al eliminar las cuentas sintéticas. Los avisos sintéticos, si hicieran falta, solo se publican en la base de pruebas y no se eliminan ni alteran avisos publicados preexistentes.

## Resultados de ejecución

Verificación completada: `npm run typecheck` y `npm run build` finalizaron correctamente; `npm test` aprobó 276 pruebas en 34 archivos. Esta suite unitaria excluye `tests/integration/**`, así que no ejecutó los casos PostgreSQL nuevos. Las pruebas PostgreSQL están pendientes porque no hay `TEST_DATABASE_URL` en el entorno; no se reporta como aprobada ninguna integración nueva. No se ejecutaron migraciones ni llamadas a OpenAI.

## Estado de `/result` y bloqueos de activación

`/result` conserva su contrato público existente, cuyos puntajes, interpretación, prioridad y estado de seguridad permanecen `not_available`/`not_assessed`. La tabla interna de puntuaciones no tiene puerto de consulta público ni se conecta al endpoint.

Bloqueos antes de habilitar DASS-21 real:

1. Seleccionar y aprobar profesionalmente la versión española exacta, su traducción y condiciones de uso digital.
2. Aprobar el mapeo entre cada pregunta oficial y su número de ítem para esa versión.
3. Revisar el motor determinista y resultados reproducibles con el responsable psicométrico.
4. Definir autorización diferenciada para acceso interno a puntajes, además de consentimiento operativo; no crear acceso de investigador por esta ruta.
5. Aprobar información al participante, retención, exportación, supresión y tratamiento de históricos con revisión ética y jurídica.
6. Ejecutar esta suite en `tesis_test_db` con 0006 aplicada y revisar resultados antes de conectar cualquier flujo.

La implementación técnica no constituye validación clínica, psicométrica, ética ni legal.
