# Matriz de decisiones y autorización DASS-21

**Candidata:** `dass21-spanish-candidate-1.1`.  
**Regla de registro:** todo lo que no tenga decisión documentada comienza en **PENDIENTE**. No se completan nombres, firmas, fechas ni referencias por inferencia. La coincidencia técnica de una fuente no equivale a aprobación.

| ID | Tema | Evidencia disponible | Responsable de revisión | Decisión requerida | Estado | Referencia de aprobación | Fecha |
|---|---|---|---|---|---|---|---|
| DASS-DEC-A | Aceptación del texto español | Cotejo técnico y hash esperado en [8A.7](sprint-8a7-dass21-spanish-source-verification.md); origen de la copia no autenticado solo por hash | Psicólogo/a responsable y responsable psicométrico | Aceptar/rechazar la edición y redacción para el propósito del estudio | PENDIENTE | No registrada | No registrada |
| DASS-DEC-B | Reactivos 1 y 12 | Son muy similares, pero distintos; ambos están preservados sin cambios en candidata 1.1 | Psicólogo/a y revisor/a de traducción | Determinar si la semejanza es fiel/aceptable; no editar la fuente dentro de esta decisión | PENDIENTE | No registrada | No registrada |
| DASS-DEC-C | Pertinencia poblacional | Estudio publicado en universitarios de una universidad pública de Lima; no demuestra equivalencia específica para ingeniería de Lima Metropolitana | Responsable psicométrico e investigador principal | Determinar adecuación lingüística, cultural, académica y límites de generalización | PENDIENTE | No registrada | No registrada |
| DASS-DEC-D | Método de puntuación | Clave oficial UNSW coincide con siete ítems por dimensión, valores 0–3 y ×2; motor `dass21-score-1.0` | Psicometrista/estadístico responsable | Aprobar su aplicación a esta traducción, versión y protocolo concretos | PENDIENTE | No registrada | No registrada |
| DASS-DEC-E | Rangos convencionales | Código `dass21-conventional-cutoffs-1.0`; etiquetas dimensionales convencionales | Psicólogo/a responsable e investigador principal | Aprobar/no usar rangos para el objetivo del estudio; delimitar interpretación | PENDIENTE | No registrada | No registrada |
| DASS-DEC-F | Consentimiento y privacidad | Finalidad existente `preliminary_assessment`; política versionada en Consent; consentir no resuelve automáticamente publicación ni retención | Responsable de investigación, asesoría ética/jurídica y privacidad institucional | Confirmar información, finalidad, granularidad de consentimiento, retiro y uso de datos | PENDIENTE | No registrada | No registrada |
| DASS-DEC-G | Retención y acceso | Score interno persistible; no hay política de retención aprobada ni endpoint/roles de investigador | Responsable de investigación y responsable institucional de datos/privacidad | Definir necesidad, plazo, acceso mínimo, auditoría, corrección, exportación y supresión | PENDIENTE | No registrada | No registrada |
| DASS-DEC-H | Respuestas potencialmente sensibles | Reactivos incluyen temas de desesperanza/sentido de vida; el sistema no tiene evaluación individual de riesgo conectada | Psicólogo/a clínico/a, responsable de investigación y comité de ética | Determinar tratamiento, límites, confidencialidad y respuesta no automatizada | PENDIENTE | No registrada | No registrada |
| DASS-DEC-I | Atención y derivación | No existe protocolo clínico aprobado ni Safety activo | Responsable clínico/institucional y comité de ética | Definir capacidad, contactos, responsabilidades, tiempos, límites y procedimiento revisado | PENDIENTE | No registrada | No registrada |
| DASS-DEC-J | Mostrar puntuaciones al estudiante | UNSW desaconseja poner puntuaciones calculadas a disposición de participantes | Psicólogo/a responsable, investigador principal, asesoría ética/jurídica; consulta a fuente DASS si se propone apartarse de su guía | Resolver explícitamente si se descarta la devolución directa; ninguna aprobación local debe describirse como aval de UNSW | PENDIENTE | No registrada | No registrada |
| DASS-DEC-K | Mostrar categorías al estudiante | Categorías son bandas convencionales, no diagnósticos; advertencia UNSW contra interpretación automatizada | Psicólogo/a responsable, investigador principal y comité de ética | Determinar si se descarta categorización automatizada para participantes; definir límites si se evalúa otra propuesta | PENDIENTE | No registrada | No registrada |
| DASS-DEC-L | Textos interpretativos | `dass21-participant-result-1.0` y textos limitativos existen como contrato futuro, no revisados para uso con participantes | Psicólogo/a responsable y comunicación accesible | Aprobar, modificar fuera del instrumento o prohibir cada texto de presentación por separado | PENDIENTE | No registrada | No registrada |
| DASS-DEC-M | Habilitación backend | Candidata no conectada; instrumento no aprobado/disponible; proveedor de soporte predeterminado deniega; ruta `/result` no expone scores | Investigador principal, responsables de aprobación anteriores y responsable de backend/release | Autorizar una versión/alcance/ambiente precisos solo tras completar criterios de activación | PENDIENTE | No registrada | No registrada |

## Uso de la matriz

- Una decisión no se considera resuelta con una conversación informal, un fixture, una prueba automatizada o un campo de código.
- Adjuntar o referenciar un acta, protocolo aprobado, revisión profesional firmada o documento institucional identificable. Registrar responsable/rol, fecha, alcance, versión exacta y referencia verificable.
- Si una decisión cambia contenido, mapeo, rangos, comunicación o autorización, crear una nueva versión inmutable y conservar esta trazabilidad; no sobreescribir la candidata 1.1 aprobando retrospectivamente.
- Las decisiones A–I y L–M sobre habilitación del instrumento no autorizan por sí mismas las decisiones J–K de devolución al participante. Revisar los checklists separados en [propuesta de divulgación](dass21-results-disclosure-proposal.md).

## Fuentes de referencia

- [Ficha de traducción Daza en UNSW](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm).
- [FAQ oficial DASS: interpretación, uso informático y devolución](https://dass.psy.unsw.edu.au/DASSFAQ.htm).
- [Cotejo técnico Sprint 8A.7](sprint-8a7-dass21-spanish-source-verification.md).
- [Decisiones de privacidad Sprint 5A](sprint-5a-privacy-decisions.md).
