# Sprint 5B.1 — diseño técnico DASS-21

## Estado del incremento

Se añadió un motor determinista puro y versionado para sumar las tres subescalas DASS-21 y expresar la equivalencia x2. El motor usa números de ítem internos y respuestas sintéticas en sus pruebas; no contiene textos de ítems ni se conecta a HTTP, a OpenAI, ni a una base de datos.

La puntuación **no está activada en la API ni se persiste**. El endpoint actual `/api/v1/preliminary-assessments/:id/result` sigue usando el contrato `schemaVersion: "1.0"` cuyo resultado de puntuaciones es `not_available`. Esto es deliberado: `InstrumentQuestion` no contiene un ordinal DASS estable que permita enlazar respuestas UUID a los ítems 1–21, y el modelo Drizzle y la migración 0004 imponen `assessment_result_scores_unavailable_check`. Para integrar puntuaciones en el endpoint se necesita primero una versión española seleccionada y aprobada, un mapeo de ítems versionado, y un cambio explícito al contrato/persistencia con migración nueva.

## Fuente y versión del instrumento

- La fuente primaria de puntuación es el sitio de los autores del DASS en UNSW. La FAQ indica que cada escala de DASS-21 tiene siete ítems, que se suman por escala y que la suma se multiplica por dos para comparabilidad con DASS-42. El [template oficial de puntuación](https://www2.psy.unsw.edu.au/groups/dass/Download%20files/Dass_template.pdf) y la [FAQ oficial](https://dass.psy.unsw.edu.au/DASSFAQ.htm) son la referencia de reglas utilizada aquí.
- La versión inglesa publicada usa opciones 0, 1, 2 y 3 y periodo de referencia de la semana anterior, según el [formulario DASS-21 oficial](https://dass.psy.unsw.edu.au/Download%20files/Dass21.pdf). Este repositorio no incluye el formulario ni reproduce su texto.
- UNSW lista varias traducciones al español (incluidas Daza et al., Bados López, García Valenzuela e IQVIA), pero advierte que no garantiza su adecuación o validez; véase [traducciones españolas](https://www2.psy.unsw.edu.au/dass/Spanish/Spanish.htm) y [FAQ de traducción/administración web](https://www2.psy.unsw.edu.au/DASS/DASSFAQ.htm). **No se seleccionó una traducción para esta tesis.** El equipo debe elegir versión y procedencia con psicología, revisar autorización/condiciones de uso y aprobar el texto exacto para la población objetivo antes de cargar ítems.
- Un estudio publicado en 2025 examinó propiedades psicométricas de DASS-21 en estudiantes universitarios de una universidad pública de Lima (n=1163), pero no determina por sí mismo qué traducción o adaptación debe usar esta tesis ni autoriza incorporar texto de ítems. Ver [artículo en SciELO](https://www.scielo.org.pe/scielo.php?lng=es&nrm=iso&pid=S1726-46342025000300291&script=sci_arttext&tlng=es).
- La FAQ oficial establece condiciones particulares para administración web/app: diferencia servicios abiertos al público de aplicaciones restringidas donde resultados se entregan a profesionales/investigadores. Como el endpoint actual devuelve resultados al propietario, la distribución digital y quién recibirá los resultados requieren revisión explícita antes de habilitarla.

## Motor implementado

Archivo: `src/modules/preliminary-assessment/domain/model/dass21-scoring.ts`.

- Versión de reglas: `dass21-score-1.0` (versionado del algoritmo, no de una traducción).
- Recibe metadatos que identifican literalmente `DASS-21`, además de 21 pares internos `{ instrumentVersionId, itemNumber, value }`; cada respuesta debe corresponder a la misma versión del instrumento.
- Rechaza metadatos mal formados, instrumento no aprobado/no autorizado, respuestas incompletas, ítems desconocidos o duplicados y valores fuera de 0–3.
- Calcula cada subescala independientemente: `rawScore` (0–21) y `equivalentScore` (`rawScore * 2`, 0–42).
- No calcula un total combinado, categorías interpretativas, severidad, prioridad, seguridad ni diagnóstico.
- Los fallos son `Dass21ScoringError` con códigos técnicos acotados; no incorporan datos de respuesta en mensajes.

Clave de puntuación codificada a partir del template UNSW:

| Escala | Números de ítem |
| --- | --- |
| Depression | 3, 5, 10, 13, 16, 17, 21 |
| Anxiety | 2, 4, 7, 9, 15, 19, 20 |
| Stress | 1, 6, 8, 11, 12, 14, 18 |

El mapeo numérico solo forma parte del algoritmo de puntuación. No sustituye el contenido ni la identidad de preguntas dentro de una versión del instrumento.

## Contrato interno calculado

El schema estricto `dass21ScoreSchema` define:

```json
{
  "schemaVersion": "1.0",
  "scoringVersion": "dass21-score-1.0",
  "instrumentVersionId": "<uuid de fixture>",
  "dimensions": {
    "depression": { "rawScore": 0, "equivalentScore": 0 },
    "anxiety": { "rawScore": 0, "equivalentScore": 0 },
    "stress": { "rawScore": 0, "equivalentScore": 0 }
  }
}
```

Es un contrato de dominio para pruebas y futura integración, no el JSON actual del endpoint REST. No usar este ejemplo como resultado de una persona.

## Integración con PreliminaryAssessment

Se reutilizan el catálogo versionado, las respuestas vinculadas a `instrumentVersionId`, la finalización e idempotencia actuales. Sin embargo, actualmente:

1. El modelo genérico de pregunta no guarda `itemNumber` ni `scoringKey`; ordenar UUIDs no sería un mapeo válido.
2. `CompletePreliminaryAssessment` crea resultados explícitamente no disponibles.
3. `assessment_results` contiene un CHECK que solo acepta `instrument_scores.status = not_available`; además el DTO/API usa la versión 1.0 con puntuaciones no disponibles.
4. El endpoint `GET /:id/result` devuelve al propietario el resultado actual.

Por ello no se cambió el endpoint, el schema DB, ni se generó migración. La próxima integración debe definir un mapeo de preguntas aprobado, nuevo schema de resultado versionado, restricciones DB compatibles y una política explícita de quién puede consultar las puntuaciones. La transición debe preservar lecturas de resultados 1.0 históricos.

## Consentimiento y límites

El flujo existente de evaluación exige `preliminary_assessment`, con versión vigente y revalidación transaccional. El motor es puro y no obtiene identidad ni consentimiento; cualquier caso de uso que lo invoque deberá conservar esa autorización y la propiedad por `accountId`. No se añadieron finalidades ni se asumió que consentimiento conversacional autoriza DASS-21.

La puntuación no es diagnóstico ni por sí sola prueba de un trastorno. No se implementaron puntos de corte/categorías ni devolución de severidad. No se infiere respuesta desde chats. El proyecto mantiene Safety separado y sin activar.

## Pruebas y procedimiento

`tests/modules/preliminary-assessment/dass21-scoring.test.ts` usa exclusivamente pares sintéticos y verifica escalas independientes, límites 0 y 21, conversión x2, asignación, respuestas faltantes, duplicadas/desconocidas, fuera de rango, metadatos inválidos/no aprobados y errores sin filtración.

Ejecutar pruebas unitarias con `npm test`; no se requiere PostgreSQL, seeder, migración ni proveedor externo para este motor. La implementación no crea un instrumento publicable y no hace que DASS-21 aparezca en `/info`.

## Pendientes antes de activar

1. Seleccionar con el psicólogo versión española y citar su fuente/traductor; revisar correspondencia y adecuación cultural a población de ingeniería de Lima.
2. Confirmar jurídicamente licencia/uso, digitalización, distribución y devolución de puntuaciones; la disponibilidad pública del cuestionario no equivale a aprobación ética o a autorización del flujo de producto.
3. Definir metadatos/mapeo de cada pregunta a un slot de puntuación inmutable y versionado; validar exactamente 21 preguntas y 7 por subescala.
4. Aprobar por profesional instrucciones, periodo de referencia, tratamiento de respuestas incompletas y quién puede ver puntuaciones.
5. Diseñar el DTO de resultado y migración compatibles con resultados históricos; implementar prueba PostgreSQL en `tesis_test_db` aislada. No cargar ni aprobar el instrumento en `tesis_db` o `tesis_demo_db` como parte de este incremento.
6. Antes de pruebas con participantes reales: aprobación ética y revisión jurídica/privacidad, retención, exportación y supresión.
