# Sprint 8A.7 — cierre del cotejo técnico DASS-21 español

**Verificación:** 2026-11-23  
**Estado de candidata:** cotejada técnicamente; profesionalmente pendiente; no aprobada, no publicada y no disponible para participantes.

## Resultado

Se leyó el archivo `.doc` proporcionado por el usuario en Microsoft Word en Vista protegida y se comparó su SHA-256 con el valor esperado. El hash coincide. La huella demuestra que esta copia corresponde al hash esperado por la solicitud; **no demuestra por sí sola que el archivo provenga de UNSW**. La ficha de Daza en UNSW enlaza el mismo nombre de archivo y la identifica como traducción española DASS-21 de Daza et al. (2002). [Ficha oficial Daza](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm)

El archivo presenta 21 reactivos numerados consecutivamente, del 1 al 21, sin números omitidos, repetidos ni textos idénticos repetidos. Contiene las instrucciones y referencia a la semana pasada, además de cuatro opciones ordenadas de 0 a 3. El texto y las etiquetas fueron transcritos literalmente a la definición versionada candidata, sin corregir ortografía ni normalizar acentos. No se reproducen aquí los reactivos completos.

Los reactivos 1 y 12 tienen formulaciones muy similares sobre relajarse, pero son textos distintos y ocupan posiciones distintas en la fuente. Se conservaron ambos literalmente; la similitud queda señalada para revisión profesional y no se trató como duplicación.

## Archivo y método

| Propiedad | Resultado |
|---|---|
| Archivo leído | `DASS21_Spanish_Daza.doc`, copia proporcionada en `C:\Users\piero\Downloads` |
| Archivo dentro de `docs/references/` | No existe en el workspace; no se copió ni se modificó el original |
| Formato | `.doc` binario de Microsoft Word; abierto en Word en Vista protegida |
| Tamaño | 37.376 bytes |
| SHA-256 calculado | `b673e8b99bd521b856555e528daf8d4b1320a9928fe07114f26be6ac17ba021a` |
| Comparación | Coincide con el hash esperado en la solicitud |
| Método de lectura | Texto extraído mediante la accesibilidad de Word; inspección visual de la página completa para confirmar el orden y presentación |
| Límite de procedencia | No se descargó el original de UNSW en esta ejecución. Hash coincidente no autentica editor, origen, fecha ni historial del archivo |

La ficha UNSW consultada identifica el trabajo de Daza, Novy, Stanley y Averill (2002), declara que el orden de la traducción sigue el del DASS-21 inglés y enlaza el documento. Esto respalda la procedencia declarada, pero no autentica esta copia local. [UNSW — ficha Daza](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm)

## Cotejo del contenido

| Elemento | Resultado |
|---|---|
| Cantidad y numeración | 21; una vez cada número del 1 al 21, en orden |
| Instrucciones | Presentes; conservadas literalmente en la candidata |
| Periodo temporal | La fuente indica “durante la semana pasada”; coincide con el periodo documentado en el formulario oficial inglés DASS-21 |
| Opciones | Cuatro opciones, ordenadas 0, 1, 2, 3; etiquetas conservadas literalmente |
| Texto y acentos | Transcripción de los 21 reactivos en `promptOriginal`; no se corrigieron formas ortográficas de la fuente |
| Omisiones o repetición exacta | No observadas en la secuencia extraída |
| Reactivos 1 y 12 | Muy similares en contenido sobre relajarse, pero no son duplicados textuales; ambos se conservan |
| Comparación previa con candidata 1.0 | La versión 1.0 solo tenía slots estructurales, no texto; no podía usarse para cotejar el texto. La candidata 1.1 incorpora ahora la transcripción fuente |

El formulario oficial DASS-21 de UNSW confirma el marco de “past week”, la respuesta 0–3 y 21 afirmaciones para el instrumento inglés. Se usó solo como control estructural independiente, no como fuente para traducir o sustituir texto español. [Formulario DASS-21 de UNSW](https://www2.psy.unsw.edu.au/Groups/Dass/Download%20files/Dass21.pdf)

## Clave de puntuación y acuerdo con el motor

Se verificó la clave contra la plantilla oficial de puntuación publicada por UNSW, independiente del `.doc` español. La secuencia de escalas para los ítems 1–21 es `S, A, D, A, D, S, A, S, A, D, S, S, D, S, A, D, D, S, A, A, D`. Cada subescala tiene siete ítems. La FAQ oficial indica sumar cada escala y multiplicar por 2 en DASS-21. [Plantilla de puntuación UNSW](https://dass.psy.unsw.edu.au/Download%20files/Dass_template.pdf), [FAQ UNSW](https://dass.psy.unsw.edu.au/DASSFAQ.htm)

La clave coincide exactamente con `DASS21_ITEMS_BY_DIMENSION` de `dass21-scoring.ts`:

- Depression: 3, 5, 10, 13, 16, 17, 21.
- Anxiety: 2, 4, 7, 9, 15, 19, 20.
- Stress: 1, 6, 8, 11, 12, 14, 18.

Por tanto, no se detectó desacuerdo entre la clave oficial consultada y el mapa del motor. Se mantienen `dass21-score-1.0`, sumas por subescala y conversión `rawScore × 2`. Los `scoringValue` 0–3 de la candidata son metadata interna asociada uno a uno con los números visibles de las opciones fuente; no se aceptan puntuaciones del cliente. La verificación del mapa no aprueba la interpretación clínica ni autoriza devolución de resultados.

## Candidata técnica

Se actualizó `dass21-spanish-candidate.ts` a `dass21-spanish-candidate-1.1`. Ahora contiene:

- Los 21 textos originales y su orden.
- Instrucciones, encabezado de opciones y referencia temporal originales.
- Las etiquetas fuente para las opciones 0–3 y sus `scoringValue` internos.
- Dimensión por ítem cotejada contra la plantilla oficial de UNSW.
- Nombre de fuente, hash coincidente con el valor esperado y fecha del cotejo.
- Estado profesional `pending`, aprobación `not_approved` y disponibilidad `not_available`.

La candidata es un manifiesto inmutable de preparación, sin `instrumentVersionId` ni UUID de preguntas. No está conectada al catálogo, a formularios, al caso de uso de scoring ni a rutas públicas. El endpoint público `/result` y el adaptador futuro no se modificaron. La suite existente comprueba que una versión pendiente no aparece en la respuesta pública de catálogo; el descriptor candidato tampoco se importa desde código productivo.

La candidata preserva literalmente formas que podrían requerir evaluación editorial. No las corregimos porque cualquier cambio sería una modificación del instrumento y requiere decisión documentada de responsables.

## Seguridad y decisiones aún bloqueantes

La categoría automatizada no es una evaluación individual de riesgo. Algunos reactivos se refieren a desesperanza o sentido de vida; ninguna respuesta activa detector, alerta, derivación ni protocolo de seguridad. Safety sigue inactivo.

UNSW advierte expresamente que los puntajes calculados no deben ponerse a disposición de quienes responden y que no debe intentarse interpretación automatizada. También indica que la interpretación corresponde a personas con formación apropiada. La candidata y el resultado HTTP continúan bloqueados para participantes. [FAQ oficial de UNSW](https://dass.psy.unsw.edu.au/DASSFAQ.htm)

Antes de cargar una versión instrumental aprobada todavía se requiere:

1. Revisión documentada por psicólogo/a o responsable psicométrico de la traducción, de las formulaciones 1 y 12, opciones, periodo temporal, adecuación cultural y pertinencia para estudiantes de ingeniería de Lima Metropolitana.
2. Confirmación por responsables de investigación de la población, administración digital y alcance de la evidencia. El estudio peruano de 2025 evaluó 1.163 estudiantes de una universidad pública de Lima y cita Daza et al. (2002), pero sus límites incluyen una sola institución, diseño transversal y ausencia de muestra clínica; no constituye aprobación del instrumento para esta tesis ni de publicación automática. [Cirilo-Acero et al. (2025)](https://www.scielo.org.pe/scielo.php?pid=S1726-46342025000300291&script=sci_arttext)
3. Decisión ética/jurídica documentada para el protocolo y uso digital concreto, incluida atribución y tratamiento de datos.
4. Política aprobada de consentimiento, acceso, retención, exportación, corrección, supresión y devolución de resultados.
5. Revisión de textos dirigidos al participante y protocolo profesional de atención/derivación, si corresponde. La puntuación DASS-21 no determina por sí misma riesgo individual ni diagnóstico.
6. Creación de una nueva `InstrumentVersion` inmutable y no disponible inicialmente, con UUID estables, opciones versionadas y pruebas; su publicación requeriría autorización explícita independiente.

## Pruebas y verificaciones

Las pruebas de manifiesto cubren 21 textos únicos y ordenados, instrucciones y periodo, etiquetas exactas, valores 0–3, clave independiente fijada como regresión, similitud no duplicada entre posiciones 1 y 12, hash/estado, inmutabilidad y ausencia de disponibilidad. Se conserva la prueba existente de catálogo para que una versión pendiente no se exponga.

Resultados ejecutados:

- `npx vitest run tests/modules/preliminary-assessment/dass21-spanish-candidate.test.ts`: 4/4 aprobadas.
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `npm test`: 417/417 aprobadas en 50 archivos.

No se ejecutaron integraciones PostgreSQL. No se modificaron rutas, OpenAPI, consentimientos, persistencia, migraciones, bases de datos ni `/result`.
