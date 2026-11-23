# Sprint 8A.1 — categorización interna DASS-21

## Alcance y estado

Se añade una función de dominio pura y determinista, versionada como `dass21-conventional-cutoffs-1.0`, que transforma un **resultado interno ya calculado y completo** en tres categorías separadas. Conserva el puntaje bruto, el equivalente y sus versiones. No recalcula respuestas, no persiste categorías y no está conectada a rutas, composición de aplicación, frontend, jobs ni a `/result`.

La función exige un descriptor de soporte del servidor, que debe corresponder al mismo `instrumentVersionId`, `scoringVersion`, versión de interpretación y base normativa. Sin descriptor compatible no devuelve categorías. No hay actualmente una versión española de DASS-21 aprobada/cargada ni un descriptor real de soporte normativo para la población de la tesis; por tanto, los fixtures de soporte en pruebas son sintéticos y **no habilitan uso real**.

## Reglas y fuente

Los límites se expresan en puntuación equivalente de la escala completa DASS (DASS-21: suma de los siete ítems de cada subescala multiplicada por dos). La asignación por cada subescala es:

| Categoría convencional | Depresión | Ansiedad | Estrés |
| --- | ---: | ---: | ---: |
| Normal | 0–9 | 0–7 | 0–14 |
| Leve | 10–13 | 8–9 | 15–18 |
| Moderado | 14–20 | 10–14 | 19–25 |
| Severo | 21–27 | 15–19 | 26–33 |
| Extremadamente severo | 28+ | 20+ | 34+ |

La tabla de rangos aparece en un material de UNSW que reproduce el scoring DASS-42 y cita el manual de Lovibond y Lovibond (1995). Se contrasta con la FAQ oficial: para comparar DASS-21 con los valores de referencia DASS se multiplica cada subescala por dos. La FAQ advierte que las etiquetas son relativas a una distribución poblacional, no significan un trastorno leve, y que la DASS es dimensional, no diagnóstica. También indica que no se deben mostrar puntajes calculados a los participantes y, en particular, no se debe intentar una interpretación automatizada para ellos. Fuentes: [UNSW, material con la tabla DASS](https://cphce.unsw.edu.au/sites/default/files/publication_related_files/Hasan_Access%20to%20Allied%20Psychological%20Services%20Program.pdf), [FAQ oficial DASS, interpretación, multiplicación y administración digital](https://www2.psy.unsw.edu.au/groups/dass/DASSFAQ.htm), [referencia del manual DASS](https://dass.psy.unsw.edu.au/order.htm).

El código clasifica por `equivalentScore`, no por `rawScore`, y verifica que `equivalentScore === rawScore * 2`. Las tres dimensiones se interpretan independientemente. No se produce categoría global, porcentaje, diagnóstico ni recomendación clínica. Puntajes brutos y equivalentes permanecen explícitamente distinguibles en el DTO interno.

## Contrato interno

`categorizeDass21Score(score, support)` recibe una estructura compatible con `Dass21AssessmentScore` y soporte normativo provisto por servidor. El score debe usar `instrumentCode: DASS-21`, `scoringVersion: dass21-score-1.0`, contener las tres subescalas completas y respetar rangos e igualdad bruto/equivalente. El soporte debe tener los identificadores y versiones exactos del score. Un instrumento diferente, score inválido, motor no soportado, ausencia de soporte o `instrumentVersionId` distinto produce error tipado y no una categoría.

El resultado interno incluye `schemaVersion`, `interpretationVersion`, `interpretationBasis`, `instrumentVersionId`, `scoringVersion` y por subescala `rawScore`, `equivalentScore` y `category`. No contiene identidad del estudiante ni una dimensión agregada. La función no verifica respuestas originales, consentimiento, propiedad ni aprobación profesional; esos controles pertenecen a la capa de aplicación y el descriptor de soporte debe venir de una fuente confiable del servidor.

## Pruebas

Las pruebas usan puntajes e identificadores sintéticos. Cubren las tres subescalas, las cinco categorías, límites y transiciones, cero y máximo, determinismo, inconsistencias, score incompleto, instrumento incorrecto, versión del motor incompatible, falta de soporte y cruce de versión instrumental. No se ejecutan migraciones, conexiones a bases, ni llamadas de IA.

## Límites y requisitos antes de publicar

- Esta implementación aplica rangos convencionales sobre el score equivalente; no demuestra validez de la traducción española ni pertinencia de los puntos de corte para estudiantes de ingeniería de Lima Metropolitana.
- La versión española y el instrumento/mapeo deben ser seleccionados, revisados y aprobados por responsables profesionales; los derechos y condiciones de uso deben confirmarse para esa versión concreta.
- Psicólogo e investigador deben decidir si esas etiquetas se usarán en el estudio y para qué propósito. La orientación oficial de UNSW desaconseja la interpretación automatizada para participantes. La existencia de la función no autoriza mostrarla al frontend o a estudiantes.
- Se requiere revisión ética/jurídica, consentimiento y política de acceso, retención, corrección, exportación y supresión antes de cualquier uso con participantes.
- Para cualquier consumidor interno futuro, exigir evaluación completa, ownership y consentimiento `preliminary_assessment` vigente; mantener `/result` sin puntuaciones ni categorías hasta aprobación explícita y cambios contractuales revisados.
- Las categorías describen rangos de puntajes del instrumento, no diagnóstico, ausencia de dificultades, severidad clínica ni decisión de tratamiento.

## Verificación

Ejecutar `npm run typecheck`, `npm run build` y `npm test`. No se requieren tablas ni migraciones para esta función pura.
