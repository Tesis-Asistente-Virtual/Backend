# Sprint 5D.1 — diseño de seguimiento conversacional longitudinal

**Versión del diseño:** 0.1 (propuesta, no contrato activo)  
**Fecha:** 2026-11-22  
**Estado:** arquitectura y revisión pendientes; no habilita procesamiento.

## 1. Resumen

LongitudinalMonitoring ya tiene inscripciones voluntarias, sesiones explícitas, finalidad `longitudinal_monitoring`, autorización fail-closed y revalidación transaccional en escrituras de inscripción/sesión. ConversationalProcessing ofrece extracción explícita con finalidades separadas `ai_conversation_processing` y `structured_signal_extraction`, y devuelve `preliminaryGuidance` efímero.

No existe actualmente una relación persistida entre conversación y sesión; las sesiones solo contienen metadatos. No hay repositorio de mediciones/observaciones ni cálculo de tendencias. El resultado de extracción no se persiste. Por tanto, el backend hoy no puede reconstruir una serie longitudinal de observaciones sin volver a leer/procesar mensajes históricos o decidir almacenar nuevos datos sensibles. Este documento no implementa ninguna de esas opciones.

## 2. Infraestructura y límites actuales

| Área | Hecho inspeccionado |
| --- | --- |
| Enrollment | `MonitoringEnrollment` pertenece a una cuenta, requiere opt-in explícito y guarda `longitudinal_monitoring` más la referencia opaca a la versión de aviso. Estados: `active`, `paused`, `withdrawn`, `completed`. |
| Sesión | `MonitoringSession` pertenece al mismo `accountId` y `enrollmentId`; se crea explícitamente mientras la inscripción está activa. Estados: `in_progress`, `completed`, `abandoned`. La tabla no tiene `conversationId`. |
| Autorización de monitoreo | Start, resume y create-session comprueban `longitudinal_monitoring` y la escritura revalida aviso/decisión en una transacción breve con orden de locks coordinado con Consent. |
| Conversación | `Conversation` pertenece a `accountId`. Mensajes tienen ID, `conversationId`, rol, estado y fecha. El caso de extracción valida propiedad, pertenencia a la conversación y estado `completed`; ordena cronológicamente y limita la selección a 1–20 IDs. |
| Extracción | Se solicita explícitamente; exige por separado `ai_conversation_processing` y `structured_signal_extraction`, con revalidación antes de la llamada externa. `reported` es el estado producido por el extractor y no verificación humana independiente. |
| Resultado | `/signals/results` devuelve `preliminaryGuidance` efímero y referencias de mensajes; no hay lectura posterior por ID ni persistencia de observaciones. |
| Medición/referencia | Hay esquemas de dominio para `MonitoringObservationReference`, `MonitoringMeasurement` y `MonitoringTrendSummary`, pero no hay tabla/repositorio operativo de mediciones o tendencias. La referencia conversacional actual es un contrato tentativo, no una asociación persistida. |
| HTTP | Monitoring tiene endpoints de enrollment/sesión; el endpoint de señales es independiente. No hay endpoint que los asocie. No se propone añadir uno en este incremento. |

Fuentes de código: `src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.ts`, sus repositorios y README; `src/modules/conversational-processing/domain/model/conversation-signal-result.ts`, `preliminary-conversation-guidance.ts` y `ExtractAuthorizedConversationSignals`; `src/modules/conversations/domain/model/conversation.ts` y `conversation-message.ts`.

## 3. Límite de contexto propuesto

LongitudinalMonitoring debe coordinar sesiones voluntarias y referencias a fuentes; Conversations sigue siendo autoridad de propiedad y contenido de conversaciones/mensajes; ConversationalProcessing sigue siendo autoridad del contrato de extracción; Consent sigue siendo autoridad de decisiones y avisos. Safety y DASS-21 no participan en esta comparación.

La orquestación futura sería un servicio de aplicación interno de Monitoring que use puertos para consultar propiedad/referencias y autorización en cada contexto, sin que Monitoring acceda directamente a tablas privadas de otros módulos. La identidad `accountId` debe provenir del contexto autenticado del servidor y propagarse a cada consulta de propietario.

La asociación debe ser explícita: una persona selecciona una sesión y mensajes completados de conversación(es) propias. No asignar automáticamente mensajes por fecha, actividad de chat, cron o inferencia del sistema. Las referencias de mensaje son la evidencia verificable; `conversationIds` se derivan de ellas, no son prueba de propiedad por sí solas.

## 4. Propuesta de contrato (no implementada)

El siguiente es un esquema conceptual para una respuesta efímera versionada, no una promesa de API ni una estructura de persistencia. No añadirlo al endpoint actual antes de resolver autorización, retención y fuente reproducible.

```json
{
  "contractVersion": "0.1-proposed",
  "enrollmentId": "550e8400-e29b-41d4-a716-446655440020",
  "sessionIds": ["550e8400-e29b-41d4-a716-446655440021", "550e8400-e29b-41d4-a716-446655440022"],
  "conversationIds": ["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440002"],
  "observationSnapshots": [
    {
      "sessionId": "550e8400-e29b-41d4-a716-446655440021",
      "conversationId": "550e8400-e29b-41d4-a716-446655440001",
      "sourceObservationIndex": 0,
      "field": "manifestation",
      "text": "En un ejemplo ficticio, la persona reportó que organiza sus tareas por la mañana.",
      "provenance": "tentative_extractor_reported",
      "observedAt": "2026-11-01T12:00:00.000Z",
      "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"],
      "sourceContractVersion": "1.0"
    }
  ],
  "evidenceReferences": [
    { "sessionId": "550e8400-e29b-41d4-a716-446655440021", "conversationId": "550e8400-e29b-41d4-a716-446655440001", "messageIds": ["550e8400-e29b-41d4-a716-446655440010"] }
  ],
  "comparisonStatus": "insufficient_evidence",
  "descriptiveChanges": [],
  "informationGaps": [{ "field": "temporal_comparison", "reason": "no_explicit_change_or_continuity_report" }],
  "limitations": [
    "Diseño propuesto; no representa una función activa.",
    "Una observación conversacional es tentativa y no equivale a una medición validada.",
    "La falta de mención no demuestra cambio, mejoría, deterioro ni ausencia de dificultades."
  ]
}
```

`sourceObservationIndex` es una posición local a una respuesta de extracción, no un identificador durable. El ID de resultado de `/signals/results` también es efímero y no identifica una observación individual. Cualquier futuro snapshot necesitaría una clave propia y versionado de origen; esos requisitos aún no están aprobados.

### Semántica candidata

- `provenance` distingue al menos `student_reported` (si en el futuro existe un registro explícito de reporte) de `tentative_extractor_reported`; no colapsar una observación de extractor en un hecho verificado.
- `comparisonStatus` solo podría ser `explicit_change_reported`, `explicit_continuity_reported`, `insufficient_evidence` o `not_available`. No incluir escalas, dirección positiva/negativa, puntuación, nivel o valoración clínica.
- `descriptiveChanges` solo contendría relaciones expresadas explícitamente por la persona y referencias a evidencia de ambos periodos. El extractor actual no produce una relación temporal validada; diferencias entre textos, dimensiones o frecuencia de menciones no bastan para inferir cambio o continuidad.
- `informationGaps` enumera ausencia de base para comparar; no deduce estados de la persona.
- `limitations` es un conjunto versionado de advertencias aprobado antes de uso. El ejemplo es ilustrativo y su texto no es contenido aprobado para estudiantes.

## 5. Reglas de comparación seguras propuestas

1. Comparar solo la misma persona, enrollment activo, sesiones explícitas de ese enrollment y fuentes verificadas bajo el mismo propietario. Si cualquier vínculo no coincide, denegar sin revelar recursos ajenos.
2. Usar solo mensajes completados elegidos explícitamente y observaciones marcadas `reported`, manteniendo origen tentativo, versión de extractor/contrato, fecha y referencias de mensaje. No persistir ni devolver transcripciones completas.
3. No comparar fuentes heterogéneas como equivalentes: reporte directo, extracción conversacional e instrumento validado permanecen separados. No mezclar versiones de contrato/instrumento ni comparar dimensiones distintas.
4. Declarar cambio/continuidad solo ante una expresión temporal explícita en evidencia del estudiante y referencias de ambos periodos, mediante un método revisado. El modelo actual no entrega esa relación, por lo que hoy el estado debe ser `not_available` o `insufficient_evidence`.
5. Ausencia de observaciones, silencio, error del extractor, sesión sin mensajes o falta de consentimiento nunca se traduce en estabilidad, mejoría, ausencia de dificultad ni seguridad.
6. No producir tendencia clínica, predicción, severidad, score, prioridad, diagnóstico, derivación ni acción automática. Ninguna extracción conversacional sustituye Safety.
7. Ordenar por `observedAt` y un desempate determinista por IDs, pero no usar el orden temporal como prueba de cambio.

## 6. Autorización y privacidad

El consentimiento no es intercambiable:

| Operación futura | Finalidades que deben considerarse | Regla propuesta para fallar cerrado |
| --- | --- | --- |
| Abrir/continuar inscripción o sesión | `longitudinal_monitoring` | Exigir decisión vigente `granted`, aviso actual y revalidación transaccional; las reglas existentes ya cubren escrituras de sesiones/enrollment. |
| Leer mensajes y extraer señales para comparación | `ai_conversation_processing`, `structured_signal_extraction` y `longitudinal_monitoring` | Comprobar cada propósito requerido; si la operación vuelve a invocar IA, revalidar los consentimientos de IA/extracción justo antes del proveedor, además de autorización longitudinal para uso comparativo. No sustituir una finalidad por otra. |
| Reutilizar una observación previamente generada | `longitudinal_monitoring` y alcance de autorización bajo el que se generó la observación | No asumir que un resultado efímero puede reutilizarse; definir si las decisiones vigentes y el aviso original permiten conservarlo y usarlo en comparación. La política está pendiente. |
| Retiro o aviso sustituido | Cada finalidad involucrada | Detener nuevas lecturas, extracciones, asociaciones y comparaciones cuando falte cualquier autorización exigida; revalidar en el límite de lectura/escritura relevante. Definir por separado el tratamiento de snapshots históricos. |

Una implementación requeriría propiedad verificada para enrollment, sesión, conversación y mensajes; `accountId` nunca proviene del body. No se deben cruzar cuentas ni usar la mera pertenencia a enrollment como prueba de propiedad del contenido. Para asociar una conversación habría que resolver carreras de retiro en Consent y revalidar cerca de cada transferencia/procesamiento, sin mantener transacciones abiertas durante llamadas externas.

Si se decide persistir snapshots, estos son datos sensibles derivados: hacen falta finalidad y aviso claros, minimización, acceso, auditoría, retención, exportación, supresión, tratamiento de históricos/backups y respuesta al retiro. No se fijan plazos ni se asume que retiro implica borrado automático. Hasta esa decisión, no persistir.

## 7. Casos conceptuales de prueba

| Caso | Resultado esperado en diseño | Cobertura requerida si se implementa |
| --- | --- | --- |
| Dos sesiones propias, activas/completadas y con consentimiento vigente | Solo generar comparabilidad si hay evidencia temporal explícita y trazable; de lo contrario `insufficient_evidence`. | Ownership, enrollment/sesión, autorización y referencias por fuente. |
| Una sesión sin observaciones reportadas | `informationGaps`; no inferir mejoría ni ausencia. | Lista vacía y limitación explícita. |
| Mensajes que no describen cambio/continuidad | Sin cambio calculado; `insufficient_evidence`. | No hacer diff semántico ni inferir tendencia desde cambios de texto. |
| Retiro de `longitudinal_monitoring` o aviso sustituido | No leer, asociar ni comparar contenido para la operación denegada. | Sin llamada al extractor ni escritura; tratamiento histórico separado. |
| Cuenta distinta o recurso ajeno | Denegar como no encontrado/no autorizado según política anti-enumeración. | No filtrar si enrollment, sesión o conversación existen. |
| Sesión fuera del enrollment indicado | Denegar; no combinar referencias. | FK lógica enrollment/session bajo el propietario. |
| Avisos con versiones diferentes entre periodos | No asumir equivalencia ni autorización continua. | Revisar aviso vigente y política de renovación; no aceptar silenciosamente versiones previas. |
| Falta consentimiento de procesamiento/extracción pero hay monitoring | Bloquear lectura de contenido y extracción. | Cero invocaciones a proveedor; no usar `longitudinal_monitoring` como sustituto. |
| Error, cancelación o resultado sin observaciones | Estado no disponible/incompleto, nunca “sin cambios”. | No convertir errores en salida vacía normal. |

## 8. Bloqueos y decisiones humanas

- **Profesional:** significado y alcance de “cambio explícitamente reportado”; qué campos son pertinentes; lenguaje y límites; si comparar observaciones tentativas tiene utilidad y cómo comunicar incertidumbre. No hay reglas aprobadas.
- **Jurídico/ética/investigación:** compatibilidad de finalidades/avisos; consentimiento para reutilización y almacenamiento; límites de participación; tratamiento de terceros; acceso, retención, exportación, supresión y retiro; evaluación ética antes de participantes.
- **Arquitectura/producto:** asociación mensaje→sesión (no inferida por fecha), posibilidad de almacenar snapshots o aceptar que no habrá historial; relación con consentimiento de IA/extracción; idempotencia, corrección/eliminación de snapshots, observaciones duplicadas y contratos históricos.
- **Operación:** observabilidad sin contenido sensible, cancelación y manejo de indisponibilidad. Sin actividad de monitoreo en tiempo real ni promesa de revisión humana.

## 9. Propuesta concreta para Sprint 5D.2

Primero cerrar decisiones de fuente y retención con responsables humanos. Si se autoriza almacenar una referencia mínima, implementar un caso de uso **explícito y no automático** para asociar mensajes seleccionados a una sesión propia, inicialmente devolviendo `comparisonStatus: not_available` y sin comparar semánticamente. Añadir puertos de propiedad/consentimiento entre contextos y pruebas unitarias/PostgreSQL de todas las finalidades y retiros. Solo un incremento posterior, tras revisión profesional y jurídica, podría evaluar reglas descriptivas de comparación. No añadir endpoint, tabla, job o procesamiento automático hasta tener política aprobada y contrato de retención.

## 10. Historial

| Versión | Fecha | Cambio | Estado |
| --- | --- | --- | --- |
| 0.1 | 2026-11-22 | Inspección del modelo existente y propuesta conceptual de referencias, autorización y comparación sin activación. | Pendiente de revisión profesional, jurídica, ética y de producto. |
| 0.2 | 2026-11-22 | Sprint 5D.2 implementa un enlace explícito de metadatos 1:1; producción deniega por defecto porque no hay aviso aprobado para ese alcance. No se reutiliza contenido ni se comparan sesiones. Véase README de LongitudinalMonitoring. | Integración técnica preparada; activación con participantes pendiente de aprobación del aviso y revisión profesional/jurídica/ética. |
| 0.3 | 2026-11-22 | Sprint 5D.3A añade un comparador puro de dos snapshots efímeros. Solo acepta continuidad/cambio mediante vínculo temporal explícito y referencias concordantes; no accede a servicios ni persiste datos. | Contrato técnico unitario; no integrado ni autorizado para uso con participantes. |
| 0.4 | 2026-11-22 | Sprint 5D.3B refuerza la procedencia: estados `reported`, periodo en cada referencia de salida, IDs de sesión/conversación en el vínculo temporal y rechazo de referencias cruzadas, duplicadas o estructuralmente incompatibles. | Garantías estructurales comprobables; no valida semántica ni autoriza integración. |

## Sprint 5D.3A — comparador descriptivo puro

### Estado y alcance

Se implementó `compareLongitudinalConversationSnapshots` en `src/modules/longitudinal-monitoring/domain/model/longitudinal-conversation-comparison.ts`. Es una función determinista de dominio que recibe dos snapshots en memoria y devuelve un contrato estricto versión `1.1`. No conoce `accountId`, repositorios, Consent, PostgreSQL, Conversations, proveedores de IA ni endpoints. Su futuro llamador deberá verificar identidad/propiedad, sesión y enrollment, asociación autorizada y todos los consentimientos aplicables antes de construir o entregar snapshots.

El snapshot contiene `sessionId`, `conversationId`, `observedAt`, `selectedMessageIds`, observaciones con `evidenceStatus: "reported"` (`observationIndex`, campo descriptivo, contexto opcional, texto efímero y `sourceMessageIds`) y `temporalContext` opcional. La afirmación temporal solo puede estar en el snapshot posterior y exige `explicitlyReported: true`; declara `change` o `continuity`, los IDs de sesión/conversación de ambos periodos, índices de observación y mensajes seleccionados del periodo posterior que expresan ese vínculo. El resultado conserva para cada evidencia `period`, `evidenceStatus`, `sessionId`, `conversationId`, `observationIndex` y `messageIds`; el vínculo temporal también conserva `explicitlyReported`, su periodo, IDs y referencia de observación. No devuelve el texto de observaciones.

### Regla de resultado

- `explicit_change_reported` o `explicit_continuity_reported` solo se devuelve cuando ambos periodos tienen observaciones reportadas con referencias seleccionadas, el tiempo es estrictamente creciente, la afirmación posterior apunta a la sesión anterior, ambas observaciones existen y coinciden en campo/contexto, y hay referencias seleccionadas para el vínculo temporal.
- La procedencia se valida por periodo: cada mensaje fuente y mensaje de vínculo debe pertenecer a los mensajes seleccionados del snapshot que lo declara; las afirmaciones incluyen IDs exactos de sesión/conversación y referencias de observación. Evidencia `ambiguous`, no reportada o no evaluada no satisface el contrato.
- En cualquier otra situación comparable, la salida es `insufficient_information` con una causa estructural (sin observaciones, un solo periodo con datos, vínculo ausente, evidencia que no coincide con ambos periodos, identidad cruzada, mensajes repetidos entre periodos o secuencia temporal no verificable). Referencias de mensaje ajenas al snapshot, índices duplicados, relaciones no soportadas y entradas mal formadas se rechazan por Zod.
- El comparador jamás infiere relaciones de diferencias textuales, cantidad de mensajes/observaciones, silencio o ausencia. La afirmación `temporalContext` es una entrada estructurada y no una conclusión que este código valide semánticamente. En el estado actual, `preliminaryGuidance` no produce este vínculo entre sesiones; por tanto, ningún flujo actual puede invocar el comparador válidamente a partir de sus respuestas sin una fuente explícita adicional revisada.

### Garantías y límites de Sprint 5D.3B

**Garantías estructurales implementadas:** estado de evidencia estrictamente `reported`; unicidad de IDs e índices dentro de cada snapshot; pertenencia de mensajes a su snapshot; distinción y orden temporal de periodos; IDs de sesión y conversación concordantes con el enlace; referencias a observaciones existentes del mismo campo/contexto; tipo de relación limitado a `change` o `continuity`; y rechazo conservador de datos incompletos o cruzados. Ninguna de estas comprobaciones necesita leer el contenido de mensajes.

**Garantías no ofrecidas:** no se prueba que el texto diga lo que afirma `temporalContext`; no se detectan contradicciones semánticas; igualdad/diferencia de cadenas no decide cambio o continuidad; no se determina mejoría, deterioro, frecuencia, intensidad, severidad ni significado psicológico. La marca `explicitlyReported: true` es una declaración estructural del llamador, no una prueba semántica. El vínculo de periodo se considera únicamente un input no confiable hasta que exista un productor revisado y autorizado.

Casos rechazados o degradados a información insuficiente: evidencia no reportada y campos extra se rechazan por esquema; mensajes duplicados o ajenos al snapshot se rechazan por esquema; sesión/conversación cruzada, sesión repetida, conversación repetida, solapamiento de mensajes entre periodos, observación inexistente o de campo/contexto distinto y fechas no estrictamente ordenadas no producen comparación. La relación `improvement`, `worsening` u otro tipo no está admitida.

Antes de integrar: un profesional debe revisar cómo se determina que una expresión temporal es explícita y cómo se comunica; responsables jurídicos/éticos deben confirmar finalidad y consentimiento para reutilizar datos entre periodos; y el futuro caso de uso debe comprobar ownership, enrollment, asociación permitida y autorizaciones vigentes antes de preparar snapshots. La asociación 5D.2 sigue denegada en producción por defecto.

### Ejemplo sintético

```json
{
  "contractVersion": "1.1",
  "sessionId": "550e8400-e29b-41d4-a716-446655440001",
  "conversationId": "550e8400-e29b-41d4-a716-446655440003",
  "observedAt": "2026-01-10T10:00:00.000Z",
  "selectedMessageIds": ["550e8400-e29b-41d4-a716-446655440005"],
  "reportedObservations": [{
    "observationIndex": 0,
    "evidenceStatus": "reported",
    "field": "duration",
    "text": "Relato sintético de ejemplo.",
    "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440005"]
  }],
  "temporalContext": null
}
```

Con `temporalContext: null`, el resultado es siempre insuficiente para declarar cambio o continuidad, aunque existan observaciones en ambos snapshots. Un fixture unitario puede construir una afirmación temporal explícita y confirmar la forma de salida, pero eso no constituye validación profesional ni autoriza un uso real.

### Riesgos y condiciones para integración futura

El comparador valida consistencia de IDs/índices y pertenencia de referencias, no la semántica ni la autenticidad del texto fuente. No existe todavía un extractor/entrada confiable que identifique expresiones temporales explícitas ni aprobación profesional para su interpretación. No integrar hasta definir esa fuente, revisar lenguaje y criterios profesionalmente, aprobar alcance de consentimiento para reutilización, conservar asociación sesión-conversación en producción denegada por defecto, y probar propiedad/consentimiento y retiro en una futura orquestación. No añadir snapshots persistidos, comparaciones automáticas, scores, severidad, diagnósticos, derivaciones o Safety en este incremento.
