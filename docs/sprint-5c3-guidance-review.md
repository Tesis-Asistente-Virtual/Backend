# Sprint 5C.3 — inventario y revisión profesional de `preliminaryGuidance`

**Versión del inventario:** 1.0  
**Fecha:** 2026-11-22  
**Estado de revisión profesional, ética y jurídica:** pendiente  
**Uso permitido de este documento:** preparación de revisión; no es aprobación ni protocolo clínico.

## 1. Objetivo y alcance

Inventariar los textos fijos que actualmente se devuelven dentro de `preliminaryGuidance` y preparar preguntas para revisión profesional. Los identificadores de este catálogo son referencias documentales estables; no se agregan al DTO ni a producción. La versión de contrato actual es `1.0`.

## 2. Hechos técnicos inspeccionados

- `preliminary-conversation-guidance.ts` define un texto fijo para `generalGuidance` y cuatro literales para `limitations`. Zod exige coincidencia literal y tupla completa; cambiar el texto requeriría revisar/versionar el contrato.
- El mapeo genera observaciones solo desde `summary.reportedFacts`, conserva referencias a mensajes seleccionados y reutiliza `missingInformation` y `clarificationQuestions`. No hay nueva llamada al modelo para redactar esta orientación.
- El endpoint existente es `POST /api/v1/conversations/{id}/signals/results`. Devuelve el resultado de manera efímera; no se agrega persistencia ni endpoint.
- OpenAPI incluye un ejemplo sintético de respuesta completa. Las pruebas de dominio cubren mapeo, falta de información, aislamiento de referencias, esquema estricto y rechazo de diagnóstico/scores; la prueba OpenAPI valida el ejemplo contra el schema Zod.
- Safety sigue inactivo: no se conecta al chat, no hay detector productivo ni dispatcher ejecutable. Véase [`docs/safety-review-matrix.md`](safety-review-matrix.md). La guía conversacional describe los límites actuales de presentación en [`docs/frontend-conversational-guidance.md`](frontend-conversational-guidance.md).

## 3. Catálogo versionado de textos actuales

Los textos se transcriben exactamente desde el contrato de dominio. Todos tienen estado **pendiente de revisión**; la inclusión aquí no representa aprobación profesional, cultural, ética o jurídica.

| ID estable | Versión | Campo / contexto | Texto exacto | Propósito técnico | Estado |
| --- | --- | --- | --- | --- | --- |
| `PG-GEN-001` | `1.0` | `generalGuidance`, después del resumen | “Puedes revisar o corregir estas observaciones. Si algo importante no aparece, puedes compartirlo solo si así lo deseas.” | Invitar a revisar/corregir voluntariamente el contenido mostrado. | Pendiente de revisión profesional, ética y jurídica. |
| `PG-LIM-001` | `1.0` | `limitations[0]` | “Este resumen se basa únicamente en los mensajes seleccionados.” | Explicitar el límite de contexto. | Pendiente de revisión profesional. |
| `PG-LIM-002` | `1.0` | `limitations[1]` | “Las observaciones pueden no representar todo lo que quisiste expresar; puedes corregirlas.” | Comunicar posible incompletitud y permitir corrección. | Pendiente de revisión profesional. |
| `PG-LIM-003` | `1.0` | `limitations[2]` | “No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.” | Evitar presentar la respuesta como evaluación, diagnóstico o severidad. | Pendiente de revisión profesional, ética y jurídica. |
| `PG-LIM-004` | `1.0` | `limitations[3]` | “No evalúa seguridad; una respuesta vacía o incompleta no demuestra ausencia de dificultades ni de riesgo.” | Aclarar ausencia de evaluación Safety y evitar inferir ausencia a partir de falta de resultado. | Pendiente de revisión profesional, ética y jurídica. |

Los IDs son etiquetas de este inventario, no propiedades de API. No se duplicaron como constantes de producción porque el schema Zod ya mantiene un único origen de verdad para los literales y el ejemplo OpenAPI debe reflejar el mismo contrato.

## 4. Matriz para revisión profesional

Completar con comentarios, cambios propuestos, responsable, fecha y decisión documentada. No incorporar cambios al contrato hasta cerrar la revisión y comprobar su impacto en estudiantes y en la API.

| ID | Claridad y comprensión | Lenguaje no estigmatizante | Adecuación cultural para estudiantes de Lima | Límites de interpretación | Accesibilidad/lectura | Observaciones y decisión profesional |
| --- | --- | --- | --- | --- | --- | --- |
| `PG-GEN-001` | ¿“Estas observaciones” deja claro qué contenido puede corregirse? ¿“compartirlo” explica dónde y con qué finalidad? | ¿La invitación evita presión o atribuir responsabilidad a la persona? | ¿El registro y vocabulario son naturales para estudiantes universitarios de Lima, sin asumir experiencias comunes? | ¿Puede entenderse como invitación a revelar más de lo que el sistema puede tratar de forma autorizada? | ¿Es breve y comprensible con lector de pantalla y lectura sencilla? | Pendiente. |
| `PG-LIM-001` | ¿“mensajes seleccionados” se entiende sin conocer el mecanismo de selección? | ¿Comunica una limitación sin culpabilizar? | ¿La referencia a selección requiere explicarse en lenguaje más familiar? | ¿Aclara suficientemente que el resumen no representa toda la conversación ni la experiencia? | ¿Se distingue visualmente del contenido observado? | Pendiente. |
| `PG-LIM-002` | ¿Se entiende qué podría estar incompleto y cómo corregirlo? | ¿La frase evita invalidar lo expresado? | ¿“quisiste expresar” resulta natural y respetuoso en el contexto local? | ¿Promete una corrección que la interfaz realmente permite realizar? | ¿La opción de corrección es accesible por teclado y tecnologías de asistencia? | Pendiente. |
| `PG-LIM-003` | ¿Se entiende “evaluación”, “diagnóstico” y “severidad”? | ¿Evita etiquetas que puedan estigmatizar? | ¿Requiere aclarar que no reemplaza la atención profesional? | ¿El descargo basta para evitar sobreinterpretar la salida o podría dar falsa seguridad? | ¿Es legible y visible, no relegado a texto difícil de encontrar? | Pendiente. |
| `PG-LIM-004` | ¿Se entiende qué significa que el sistema no evalúa seguridad? | ¿La mención de riesgo puede ser alarmante o confusa sin explicación contextual? | ¿El término y contexto son adecuados para la población prevista? | ¿Deja claro que esto no es respuesta ante peligro inmediato ni canal de emergencia? | ¿Es visible y accesible sin depender solo del color o de un modal? | Pendiente. |

### Preguntas de revisión

- ¿Qué nivel de lectura y comprensión debe verificarse y con qué método participativo?
- ¿Conviene identificar explícitamente que el resumen se produjo con asistencia de IA, y cómo explicar sus errores posibles?
- ¿La invitación a corregir/remitir información es compatible con el flujo real de consentimiento, la selección explícita de mensajes y la falta de persistencia del resultado?
- ¿Qué contenido debe acompañar la orientación para evitar que se interprete como evaluación psicológica o recomendación individual?
- ¿Qué pruebas de accesibilidad y comprensión se deben completar antes de cualquier prueba con estudiantes?
- ¿Qué revisión cultural y lingüística corresponde, y quién puede aprobarla en nombre de la población de Lima Metropolitana?

## 5. Situaciones sensibles y límite actual

Los textos de este contrato son limitaciones y orientación general, no un protocolo. En particular, `PG-LIM-004` afirma explícitamente que el resultado no evalúa seguridad. Safety está desactivado y no existe detección automática ni despacho de acciones desde este flujo. Por ello:

- No mostrar `generalGuidance` ni las limitaciones como respuesta aprobada para una señal de peligro inmediato.
- No derivar ni contactar automáticamente a profesionales, familiares, servicios de emergencia u otros terceros.
- No inferir que un resultado vacío, error, mensaje sin observaciones o ausencia de detección significa que la persona está segura.
- No afirmar que la aplicación monitorea en tiempo real o que una persona revisará el contenido.
- Mantener bloqueada cualquier conducta específica ante señales sensibles hasta que exista protocolo profesional, revisión ética/jurídica, responsabilidades operativas y mecanismo independiente aprobado.

La decisión de qué debería comunicarse, cuándo ofrecer recursos, qué supervisión humana existe y cómo confirmar la vigencia de recursos locales requiere revisión profesional e institucional. Este documento no propone texto de crisis ni una ruta de emergencia.

## 6. Decisiones pendientes

**Psicología / equipo profesional:** idoneidad de cada frase; lenguaje no estigmatizante; adecuación cultural; límites del sistema; mensajes ante incertidumbre; necesidad y alcance de revisión humana; criterios para revisar o retirar textos.

**Ética / investigación:** comprensión del consentimiento y de la invitación a compartir; evaluación con población representativa; salvaguardas, supervisión, accesibilidad y criterios de pausa del estudio.

**Asesoría jurídica / responsable de datos:** transparencia sobre IA y tratamiento; compatibilidad del texto con avisos y finalidades; derechos, manejo de información sensible, proveedores, retención/supresión y cualquier actuación ante peligro. No se concluye cumplimiento normativo.

## 7. Criterios para una futura aprobación y cambio

Antes de cambiar un literal o presentarlo en un piloto: (1) registrar comentarios y aprobación identificable de profesionales; (2) completar revisiones ética y jurídica aplicables; (3) probar comprensión, accesibilidad y adecuación cultural; (4) definir el alcance de uso y el tratamiento de datos; (5) actualizar el literal y su versión de contrato de forma compatible; (6) actualizar OpenAPI, guía y pruebas exactas; y (7) verificar que la presentación no sugiera diagnóstico, score, severidad, seguridad evaluada, supervisión o derivación no implementadas.

## 8. Historial

| Versión | Fecha | Cambio | Estado |
| --- | --- | --- | --- |
| 1.0 | 2026-11-22 | Inventario inicial de los cinco textos fijos y matriz de revisión; no modifica textos ni comportamiento. | Pendiente de revisiones profesional, ética y jurídica. |
