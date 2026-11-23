# Sprint 5D.5 — referencias a observaciones conversacionales efímeras

**Fecha:** 2026-11-23  
**Estado:** value object y funciones puras; sin endpoint, persistencia ni integración longitudinal activa.

## Hallazgos de inspección

- `preliminaryGuidance.observations` expone `sourceObservationIndex`, `field`, `contextDomain` opcional, texto y `sourceMessageIds`.
- El resultado HTTP `/signals/results` ya contiene `id` (UUID de resultado), `conversationId`, `sourceMessageIds`, `observations` del extractor y `preliminaryGuidance`.
- Cada resultado se construye en el controller con un `randomUUID()` nuevo. Ese ID identifica una ejecución efímera concreta, no una observación persistida ni una clave estable entre ejecuciones.
- Una fila de `preliminaryGuidance.observations` puede compartir `sourceObservationIndex` con otras filas (por ejemplo, campos de manifestación y contexto). Por ello el índice de guidance, campo/contexto, IDs de fuente y resultado deben quedar vinculados juntos.
- No hay una tabla, repositorio ni almacenamiento de snapshots/resultados conversacionales.

## Referencia elegida

Se añadió el value object estricto `ConversationResultObservationReference` en `src/shared/domain/conversation-result-observation-reference.ts`, contrato propio `1.0`:

```json
{
  "contractVersion": "1.0",
  "resultId": "550e8400-e29b-41d4-a716-446655440099",
  "conversationId": "550e8400-e29b-41d4-a716-446655440001",
  "observationIndex": 1,
  "sourceObservationIndex": 0,
  "field": "context",
  "contextDomain": "academic",
  "sourceMessageIds": ["550e8400-e29b-41d4-a716-446655440010"]
}
```

Semántica:

- `resultId` es el `id` ya emitido por `/signals/results`; delimita una ejecución específica.
- `conversationId` ata la observación a la conversación del resultado.
- `observationIndex` es la posición cero-based dentro de `preliminaryGuidance.observations`; identifica exactamente la fila mostrada.
- `sourceObservationIndex` conserva el índice del extractor para trazabilidad, sin usarlo como identidad global.
- `field`, `contextDomain` y `sourceMessageIds` verifican que no se sustituya por otra observación/fuente.
- El value object no genera UUID ni persiste nada. El orden de IDs de mensaje se normaliza para que el mismo resultado+posición produzca el mismo objeto.

## Creación y resolución

`createConversationResultObservationReference(result, observationIndex)` toma el payload efímero existente y la posición concreta de guidance. Comprueba que:

1. El ID y la conversación del resultado sean válidos.
2. Guidance pertenezca a esa conversación y comparta sus mensajes fuente.
3. La posición exista.
4. El `sourceObservationIndex` apunte a una observación existente del extractor.
5. Campo, contexto y texto de guidance correspondan estructuralmente a evidencia marcada `reported` en esa observación del extractor.
6. Los IDs de mensaje sean las mismas referencias de origen.

`resolveConversationResultObservationReference(reference, exactResultPayload)` vuelve a comprobar la identidad de resultado y conversación, posición, índice fuente, campo/contexto y referencias. Devuelve la observación exacta solo frente al payload original compatible. No lee mensajes ni verifica que el texto refleje semánticamente su contenido.

## Vida útil y garantías

- La referencia es determinista **dentro de una misma instancia de resultado**; no es estable entre llamadas a extracción.
- Si se vuelve a ejecutar la extracción, el resultado obtiene un nuevo `resultId`. Una referencia anterior se rechaza como `result_mismatch`, aunque conversación, posición y mensajes coincidan.
- Si el resultado deja de estar disponible, no existe un endpoint ni almacenamiento desde el que reconstruirlo: la resolución falla `result_unavailable`. No se vuelve a consultar ni reprocesar historial.
- Si no hay observaciones, una posición fuera de rango falla `observation_not_found`; no se inventa una observación.
- Cambios cruzados de conversación, campo, índice o mensajes fallan por discrepancia estructural.
- Estas comprobaciones prueban consistencia de DTO/procedencia declarada, no propiedad, identidad de estudiante ni soporte semántico. Un futuro caso de uso deberá autorizar ownership y Consent antes de obtener/entregar el resultado.

## Declaración longitudinal

El contrato puro de declaración cambió internamente de versión `1.0` (`referencedObservationId` UUID sin productor) a `1.1`, con `referencedObservation` anidado usando este value object. No hay contrato HTTP que modificar ni clientes conectados. Esta referencia no autoriza asociación sesión-conversación ni reutilización de mensajes; esa asociación sigue bloqueada por defecto.

## Pruebas sintéticas

`tests/modules/conversational-processing/conversation-result-observation-reference.test.ts` cubre referencia y resolución válidas, índice no existente, conversación/resultados diferentes, mensajes cruzados, extracción rehecha, ausencia de observaciones, pérdida del payload efímero y determinismo. Las pruebas usan resultados y referencias completamente ficticios.

## Pendientes

- Mantener el resultado disponible solo durante la interacción actual; no conservar referencias después de perder el payload.
- Definir, con revisión jurídica/ética y profesional, el alcance de cualquier futura asociación y lectura histórica; no asumir consentimiento retroactivo.
- Antes de integrar la declaración, un caso de uso debe comprobar JWT/owner, sesión y enrollment, consentimiento exacto vigente y asociación permitida; las marcas `source`/`confirmationStatus` deben asignarse desde una acción autenticada del servidor.
- Si el producto necesita que una referencia sobreviva a la respuesta o extracción, diseñar aprobación, retención y almacenamiento por separado. No convertir este contrato efímero en ID durable por conveniencia.

## Sprint 5D.6 — frontera interna de confianza

Se añadió `BuildStudentLongitudinalDeclaration`, una orquestación interna no registrada en rutas ni composición de producción. Su DTO estricto solo acepta `referencedObservation`, `responseType` y `optionalDescription`; rechaza `accountId`, `source`, `confirmationStatus`, `createdAt`, consentimientos y propiedades extra.

El llamador debe pasar la cuenta obtenida de autenticación verificada y el ID de sesión como selector. El servicio no trata estos IDs como prueba: `OwnedMonitoringConversationContextReader` debe encontrar el vínculo bajo el propietario y confirmar enrollment activo, sesión `in_progress`, conversación activa y asociación verificada. Si el lookup no puede probar todas esas condiciones, falla cerrado.

Antes de resolver la referencia, exige grants actuales separados para `longitudinal_monitoring`, `ai_conversation_processing` y `structured_signal_extraction`, además de una política que autorice las versiones exactas de esos avisos para este uso. El resultado fuente debe traer metadatos de autorización capturados por el servidor al producirlo; las tres versiones de origen deben coincidir con las decisiones actualmente vigentes. Después se resuelve la referencia contra el payload exacto y recién entonces el servidor establece `sessionId`, `conversationId`, `source`, `confirmationStatus` y `createdAt` de la declaración 1.1.

### Qué garantiza y qué falta

Implementado y probado con dobles: validación estricta de entrada; consulta por propietario; estados activos; triple consentimiento y concordancia de versiones; denegación por falta de alcance aprobado; resultado exacto; referencia resoluble; y asignación de metadata del servidor. No hay persistencia ni llamada externa.

Los cuatro puertos son contratos de aplicación y solo tienen fakes en tests. **No existe adaptador productivo** para el vínculo autorizado, la revisión de alcance exacto, ni recuperación del resultado efímero con la procedencia de consentimiento que exige esta frontera. La composición de producción no construye el servicio. La asociación sigue denegada por defecto; el resultado HTTP actual tampoco incorpora procedencia de consentimiento al emitirse.

Por tanto, esto no demuestra identidad real, autorización real ni disponibilidad posterior del resultado. En un flujo HTTP separado, una vez perdido el resultado original no puede recuperarse sin almacenamiento/caché aprobado; el servicio devuelve fallo en vez de reconstruirlo o aceptar un payload reenviado por el cliente. La referencia estructural no prueba que el texto respalde semánticamente una declaración. `student_confirmed` solo se asigna al construir una respuesta interna después de invocación explícita del servicio; no hay endpoint/UI que lo haga hoy.

### Responsabilidades futuras del frontend y condiciones de activación

Cuando exista una API aprobada, el frontend solo enviará la referencia recibida, el tipo de respuesta y una descripción opcional. Nunca enviará identificadores de propietario, fuente, confirmación, timestamps ni consentimientos. Debe permitir `unsure` y `prefer_not_to_answer`, corrección/rechazo, explicar que la confirmación no es validación clínica y no presentar resultado cuando la autorización o referencia falle.

Antes de conectar: construir adapters de ownership/association y consent con revisión del aviso exacto; definir cómo la operación mantiene disponible el payload efímero original y su procedencia sin un UUID persistente inventado; resolver si se requiere una sesión de operación efímera aprobada o cambiar el flujo; completar revisión clínica/jurídica/ética y retención; y añadir integración HTTP/PostgreSQL solo con entorno de prueba aislado. Hasta entonces, mantener la frontera sin registro productivo.
