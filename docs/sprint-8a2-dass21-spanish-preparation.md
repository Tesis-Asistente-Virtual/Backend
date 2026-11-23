# Sprint 8A.2 — preparación de una versión española DASS-21

## Resultado y estado

Se preparó un manifiesto de procedencia y estructura técnica para una **candidata** española DASS-21. No se cargaron reactivos, no se asignaron UUID de preguntas, no se creó una `InstrumentVersion`, no se publicó ni habilitó ningún instrumento, y no se modificó la API. El descriptor `dass21-spanish-candidate-1.0` no es una versión del cuestionario ni una aprobación.

| Elemento | Estado |
|---|---|
| Candidata de traducción | Daza et al. (2002), pendiente de cotejo de fuente y revisión profesional |
| Idioma | `es` |
| 21 posiciones, orden y dimensión | Preparados como estructura; asignación de dimensión reutiliza el mapa canónico del motor existente |
| Opciones numéricas | Valores estructurales `0`, `1`, `2`, `3`; no se inventaron etiquetas traducidas |
| Texto de reactivos | No incorporado; no se reproducen preguntas |
| IDs de preguntas / versión instrumental | No asignados |
| Revisión y aprobación | Pendientes; no aprobado |
| Disponibilidad para API o participantes | No disponible |
| Migración / carga en base de datos | No necesarias para este manifiesto; no ejecutadas |

El manifiesto es metadato interno de preparación y no está conectado al catálogo Drizzle, `GET /info`, inicio de evaluación, formulario, motor de scoring ni categorización. El catálogo actual expone únicamente versiones `approved`, con aprobación/licencia aceptadas, preguntas completas y orden explícito. `/result` conserva su contrato sin puntuaciones.

## Fuente y evaluación de candidatas

La página de traducciones de UNSW enumera varias traducciones españolas realizadas por terceros, incluidas Daza, Bados López, García Valenzuela e IQVIA. La página de [Daza et al.](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm) identifica expresamente una traducción DASS-21 y su referencia principal: Daza, Novy, Stanley y Averill (2002), *The Depression Anxiety Stress Scale-21: Spanish translation and validation with a Hispanic sample*, *Journal of Psychopathology & Behavioral Assessment*, 24(3), 195–205. Esa página indica que el orden de sus ítems coincide con el DASS-21 inglés y remite a la clave de puntuación. Se registra como candidata de revisión, no como versión seleccionada o aprobada.

Existe evidencia local relevante: el estudio de [2025 en estudiantes de una universidad pública de Lima](https://www.scielo.org.pe/scielo.php?pid=S1726-46342025000300291&script=sci_arttext) evaluó propiedades psicométricas en 1.163 estudiantes de la Universidad Nacional Federico Villarreal y cita la adaptación española Daza de 2002. Es evidencia para una población universitaria peruana en una institución; no prueba equivalencia de la redacción exacta que vaya a cargarse, validez específica en estudiantes de ingeniería, generalización a otras universidades, ni autorización para el uso propuesto. El artículo informa límites de generalización por provenir de una sola institución y por su diseño transversal.

UNSW publica traducciones de terceros, pero declara que no garantiza su adecuación o validez. Su FAQ indica que el cuestionario DASS es de dominio público y describe la disponibilidad de traducciones publicadas; también señala que no respalda software específico y que puntajes calculados no deben entregarse a participantes ni interpretarse automáticamente. Estas condiciones no sustituyen una comprobación jurídica de la versión concreta ni una revisión profesional del uso en este producto.

**Recomendación para revisión:** evaluar primero la candidata Daza porque es una DASS-21 identificada y citada por el estudio peruano de Lima. Antes de elegirla, el psicólogo responsable debe cotejar el archivo oficial completo, su edición, opciones/instrucciones y clave; decidir si representa el español y población objetivo; y documentar autorización y propósito. La inclusión del descriptor no toma esa decisión por el responsable.

## Estructura técnica preparada

`src/modules/preliminary-assessment/domain/model/dass21-spanish-candidate.ts` contiene un esquema Zod estricto y un descriptor inmutable. Cada posición estructural tiene:

- `itemNumber`: número de referencia del ítem, 1–21.
- `displayOrder`: posición de presentación, 1–21; debe coincidir con el número para esta candidata porque la fuente indica el mismo orden que la versión inglesa.
- `dimension`: `depression`, `anxiety` o `stress`, derivado del mapa ya usado por `scoreDass21`.
- `responseValues`: `[0, 1, 2, 3]`.

El validador exige exactamente 21 posiciones únicas, contiguas y ordenadas; comprueba las dimensiones contra el mapa del motor; y restringe los valores de respuesta al tuple 0–3. No incluye `prompt`, texto de opciones, `questionId`, `instrumentVersionId` ni decisiones de aprobación. Los UUID reales deberán asignarse solo al crear una versión formal concreta, sin asumir que el número de ítem equivale a un UUID.

El motor ya contiene la suma por subescala, la validación de 21 respuestas numéricas 0–3 y la conversión DASS-21 ×2. Este incremento no cambia sus cálculos ni las reglas de interpretación `dass21-conventional-cutoffs-1.0`.

### Brecha del formulario que debe resolverse antes de cargar

El contrato de preguntas ofrece `number` con mínimo/máximo y respuesta numérica, o selección con opciones `{id,label}` y respuesta `optionId`. El scoring DASS requiere respuestas numéricas 0–3. Para presentar opciones etiquetadas fielmente y puntuar sin ambigüedad, el futuro proceso de carga deberá fijar y probar la correspondencia entre cada opción estable y su valor numérico, o justificar formalmente una presentación numérica accesible. No se debe convertir texto de etiqueta a score mediante heurísticas.

El modelo persistente actual tampoco almacena idioma/procedencia como campos dedicados; aprobación y licencia tienen metadatos generales. No se necesita migración mientras el manifiesto no sea un instrumento cargable. Antes de almacenar una versión real, evaluar una ampliación aditiva de metadatos versionados para idioma, fuente, revisión y huella de contenido, manteniendo intactos los fixtures y versiones anteriores.

## Criterios pendientes antes de carga o habilitación

1. Confirmar y archivar la fuente exacta de la traducción candidata y cotejar los 21 reactivos, orden, instrucciones, marco temporal y etiquetas de respuesta con el original publicado; no reescribir ni traducir contenido.
2. Obtener revisión documentada de psicólogo y responsable psicométrico para estudiantes de ingeniería de Lima Metropolitana; distinguir evidencia publicada de validación para la población y el uso concretos.
3. Revisar condiciones de uso, atribución, publicación y administración digital para esta traducción específica con asesoría jurídica/investigación.
4. Definir la estructura de opciones/valores, IDs estables y mapeo por versión; comprobar integridad entre pregunta, número, dimensión y scoring.
5. Definir aprobación de instrumento, consentimiento, quién puede acceder a puntajes, retención, corrección, exportación y supresión. No entregar puntuaciones o categorías al participante por la existencia del motor.
6. Crear una nueva versión de instrumento en estado no disponible primero, validar 21 ítems y orden, congelar mapeo, obtener aprobaciones humanas y solo después considerar publicación explícita.
7. Añadir tests de catálogo/API y PostgreSQL con fixture separado, además de regresión que mantenga el endpoint público `/result` libre de scores.

## Pruebas

El test nuevo valida longitud exacta, orden, asignación por dimensión, opciones 0–3, rechazo de datos incompletos/reordenados/incompatibles, metadatos pendientes y que el catálogo HTTP de información no devuelva instrumentos cuando no hay versión disponible. Los datos son estructurales y sintéticos; no contienen preguntas reales ni llamadas a OpenAI o PostgreSQL.

## Fuentes

- [UNSW — traducciones españolas DASS](https://www2.psy.unsw.edu.au/dass/Spanish/Spanish.htm).
- [UNSW — ficha Daza et al. y descarga de la traducción DASS-21](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm).
- [Daza et al. (2002), DOI](https://doi.org/10.1023/A:1016014818163).
- [Estudio psicométrico en estudiantes universitarios peruanos, 2025](https://www.scielo.org.pe/scielo.php?pid=S1726-46342025000300291&script=sci_arttext).
- [UNSW — advertencia sobre la calidad de traducciones de terceros](https://dass.psy.unsw.edu.au/DASS%20Translations.htm).
- [UNSW — FAQ sobre uso, administración digital, interpretación y traducciones](https://dass.psy.unsw.edu.au/DASSFAQ.htm).
