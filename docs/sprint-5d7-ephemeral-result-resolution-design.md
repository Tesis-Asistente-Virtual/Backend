# Sprint 5D.7 — diseño de resolución de resultados efímeros

**Estado:** propuesta arquitectónica; no implementada ni habilitada.  
**Alcance:** diseño, sin endpoints, tablas, caché, token firmado, migración ni cambios a consentimientos.

## Resumen de contratos existentes

- `POST /api/v1/conversations/:id/signals/results` obtiene un resultado descriptivo para una solicitud explícita. La respuesta incluye `id`, `conversationId`, `sourceMessageIds`, observaciones, brechas, preguntas, resumen y `preliminaryGuidance`.
- El ID del resultado se crea para cada ejecución. Delimita una respuesta concreta y no es una clave durable.
- `preliminaryGuidance.observations` contiene índices, texto marcado como reportado y referencias a mensajes seleccionados. La referencia 1.0 combina `resultId`, `conversationId`, posición, campo y referencias fuente; solo se resuelve contra el payload exacto que la originó.
- `/signals/results` no persiste el resultado ni conserva en servidor las versiones de consentimiento que autorizaron su producción.
- `BuildStudentLongitudinalDeclaration` recibe un selector de referencia, exige contexto y consentimiento aportados por puertos, compara las versiones actuales con la procedencia de origen y construye la declaración 1.1. No está registrado en producción y actualmente no hay adaptador que resuelva el payload original.
- La asociación sesión-conversación está denegada por defecto. JWT por sí solo no autoriza tratamiento ni reutilización histórica.

## Alternativas

| Opción | Seguridad y privacidad | Complejidad, carga y latencia | Revocación y riesgos | Viabilidad para prototipo |
|---|---|---|---|---|
| **A. Generar y consumir en una sola operación en memoria** | No conserva el resultado tras la operación. Puede mantenerlo en el mismo proceso mientras se presenta y confirma. | Baja si generación, revisión y acción caben en una sola interacción; en HTTP ordinario la respuesta termina antes de que el estudiante pueda revisar y actuar. Mantener una operación abierta o introducir estado de sesión añade complejidad. | Revocable mientras la operación valida nuevamente consentimiento. Desconexión o reinicio pierde el resultado. No debe aceptar el resultado reenviado por el navegador. | No resuelve por sí sola el patrón actual de dos solicitudes HTTP. Adecuada solo si una experiencia de interacción continua se diseña y revisa expresamente. |
| **B. Resultado temporal de servidor con vencimiento y propietario** | Conserva temporalmente contenido sensible en servidor; puede guardar resultado exacto, propietario, conversación, fuentes y versiones autorizantes. No expone payload confiable al cliente. | Complejidad moderada: TTL, capacidad, acceso por propietario, limpieza, concurrencia y comportamiento ante reinicio. Agrega lectura/escritura del caché, no una nueva llamada al modelo. | Puede invalidarse al retirar o sustituir consentimiento, expirar o consumirse. Requiere revalidar grants y versión exacta al leer. Riesgo de exposición por caché compartida, backups, métricas o logs debe limitarse. | **Recomendada para el prototipo**, con TTL corto aprobado, caché privada de servidor y despliegue de una instancia; la pérdida por reinicio debe ser explícita. No implica persistencia durable. |
| **C. Referencia firmada por servidor** | Una firma prueba que el servidor emitió claims, no que el cliente siga autorizado. Incluir observaciones en el token expone texto sensible en el cliente; firmar solo IDs/digest no permite recuperar el resultado descartado. | Complejidad criptográfica y operativa: expiración, rotación de claves, formato, alcance y validación. Añade transporte sin eliminar la necesidad de resolver el payload. | La firma no revoca por sí sola. Exige consulta de consentimiento vigente y mecanismos para invalidación/consumo o expiración breve. Puede sufrir replay hasta vencer. | No recomendada sola. Solo tendría sentido como capacidad opaca que apunte a la opción B; eso añade complejidad sin reducir el estado servidor necesario. |
| **D. Reprocesar explícitamente mensajes autorizados** | No reutiliza un resultado anterior, pero vuelve a tratar mensajes históricos y genera contenido que puede diferir del mostrado originalmente. | Implementación aparentemente sencilla, pero implica latencia, coste y posible nueva llamada al proveedor; el estudiante debe revisar el nuevo resultado. | Exige consentimiento vigente para lectura histórica, selección y alcance exactos. Una nueva generación no resuelve una referencia antigua; debe emitirse un resultado nuevo y solicitar confirmación de ese resultado. | Fallback posible solo como una acción nueva, visible y autorizada. No debe ocurrir automáticamente ni presentarse como resolución del resultado previo. |

### Recomendación

Para una futura prueba de prototipo, usar **B: un registro temporal privado en servidor para el resultado exacto**, inicialmente en una única instancia y con expiración corta definida antes de implementarlo. La clave de consulta será solo un selector aleatorio o el `resultId` existente; la autorización se basará en `accountId` autenticado y metadatos guardados por servidor. El payload completo nunca se aceptará del frontend como evidencia.

Esta recomendación requiere una decisión previa sobre duración, eliminación y efecto del retiro. Si no se aprueba conservar temporalmente texto derivado y referencias, no se habilita declaración posterior. La alternativa A no permite al estudiante ver el resultado y luego confirmar en una segunda solicitud sin algún estado intermedio. La opción C no recupera datos descartados; D constituye un nuevo procesamiento, no una forma de recuperar el resultado exacto.

## Flujo futuro propuesto

1. El estudiante se autentica; el backend deriva `accountId` del JWT.
2. El backend verifica ownership y estados de conversación, enrollment y sesión. La asociación continúa bloqueada hasta aprobación e integración verificable.
3. Comprueba autorización vigente para `ai_conversation_processing`, `structured_signal_extraction` y `longitudinal_monitoring`, junto con el alcance y versiones exactos que cubran reutilización y comparación. Cualquier falta, retiro, sustitución o fallo cierra el flujo.
4. Obtiene únicamente los mensajes seleccionados y autorizados y genera el resultado por la ruta explícita existente.
5. El servidor conserva temporalmente el resultado exacto, referencias fuente, propietario y versiones de avisos autorizantes; no guarda transcripción adicional ni lo registra en logs.
6. Devuelve al frontend la representación descriptiva para revisión. El frontend permite corregir, confirmar, indicar `unsure` o declinar. La respuesta HTTP recibida no prueba autoría.
7. Ante una acción explícita posterior, el cliente envía solo la referencia al resultado/observación y la respuesta. No envía `accountId`, `source`, `confirmationStatus`, `createdAt`, consentimientos ni un resultado reconstruido.
8. El backend revalida JWT/ownership, estado, asociación permitida, consentimiento vigente, versiones exactas y vencimiento. Resuelve la referencia únicamente contra el registro temporal del servidor. Si el resultado expiró, fue invalidado o no coincide, rechaza y no reprocesa historia automáticamente.
9. Solo entonces construye la declaración con procedencia y fecha asignadas por servidor. Por defecto permanece efímera; no se guarda ni se envía a LongitudinalMonitoring hasta aprobar retención, uso y revisión profesional/jurídica.

En términos de secuencia: `JWT → ownership/estado → consentimientos y alcance → extracción explícita → registro temporal exacto → revisión del estudiante → acción explícita → revalidación → resolución exacta → declaración efímera`.

## Amenazas y mitigaciones requeridas

| Amenaza | Mitigación de diseño |
|---|---|
| Replay de referencia o doble confirmación | Vincular resultado a propietario, vencimiento y estado de uso; decidir si la confirmación es de un solo uso. Rechazar referencias ya consumidas. No persistir la declaración por deduplicación implícita. |
| Resultado manipulado por cliente | Resolver siempre desde estado servidor; aceptar del cliente solo referencia y respuesta permitida bajo schema estricto. |
| Cruce de cuentas/conversaciones | Consulta acotada a `accountId` autenticado, `conversationId` y resultado; comparar todos los IDs y referencias antes de construir declaración. |
| Retiro o sustitución de aviso | Revalidar cada finalidad al leer/confirmar; invalidar referencias emitidas bajo versiones antiguas. No inferir autorización retroactiva. |
| Resultado vencido, evicto o pérdida por reinicio | Responder como no disponible. No aceptar copia del frontend ni ejecutar reprocesamiento silencioso. Una acción nueva de reprocesamiento requiere consentimiento y confirmación propios. |
| Doble clic/reintento de red | Definir semántica idempotente de consumo mediante estado temporal atómico o un identificador de operación. No afirmar idempotencia durable sin persistencia. |
| Reutilización histórica no autorizada | Limitar el conjunto de mensajes al resultado original y exigir que avisos/alcance aprobados cubran expresamente esta finalidad secundaria. Si no, bloquear asociación y comparación. |
| Inyección o exceso de contenido desde cliente | Validar estrictamente la forma y límites de la declaración; nunca tomar `text`, observaciones o evidencia reenviados como fuente. Limitar descripción opcional y no concatenarla como instrucción para IA. |
| Exposición vía logs, dumps o métricas | No registrar payload ni texto, evitar valores sensibles en errores, excluir caché de logging/telemetría y restringir inspección operativa. Definir borrado/retención antes de producción. |

## Decisiones pendientes

- Revisión profesional, jurídica y ética de la finalidad secundaria: reutilizar mensajes y resultados conversacionales para seguimiento entre sesiones.
- Versiones exactas de avisos que autorizarían análisis, extracción, asociación y seguimiento; el nombre de una finalidad no constituye por sí mismo autorización suficiente.
- TTL, datos exactos retenidos, eliminación ante retiro, caducidad, eviction y tratamiento de reinicios.
- Si permitir una sola confirmación o corrección/revocación y cómo expresar esas acciones sin persistencia.
- Si la caché solo puede operar en una instancia o necesita un almacén temporal compartido; no usar almacenamiento distribuido sin revisar controles de acceso, cifrado, retención y observabilidad.
- Reglas de autorización de asociación sesión-conversación y forma de verificar ownership en producción.
- Si una futura declaración se queda efímera o tiene un propósito de retención separado. No se proponen plazos legales.
- Validación profesional de lenguaje mostrado; una confirmación del estudiante no es verificación semántica ni clínica.

## Criterios de aceptación para implementación posterior

- Ninguna ruta/composición activa hasta que exista política aprobada y adapters reales de ownership, consentimiento y resolución temporal.
- Resultado temporal generado por servidor; lectura por propietario y alcance, con expiración y borrado comprobables.
- Procedencia incluye `accountId`, conversación, fuentes seleccionadas, `resultId`, versiones de contrato/extractor y versiones de consentimiento; nunca se entrega al cliente como claims autoritativos.
- Consentimiento comprobado antes de leer mensajes, antes de transferirlos al proveedor, al devolver el resultado si aplica, y nuevamente al confirmar; retiro o aviso sustituido invalida el resultado temporal.
- Referencia resuelta contra el payload exacto; resultado no disponible o mismatch falla cerrado y no provoca reprocesamiento histórico.
- Entrada del cliente estricta y limitada a referencia y respuesta explícita; campos reservados y extra se rechazan.
- Manejo probado de replay, doble solicitud, caducidad, eviction, revocación, aviso sustituido, cruces de cuenta, fallos de caché y reinicio.
- Sin datos de contenido en logs, sin resultado durable, sin nueva llamada OpenAI para resolver una referencia y sin mensajes automáticos, puntuaciones o diagnósticos.
- Pruebas sintéticas unitarias y de integración del adapter temporal y consentimiento; verificación de que el endpoint público de resultados no expone información de propiedad o procedencia interna.

## Estado

La opción B es una recomendación de diseño, no una funcionalidad implementada. No se crearon endpoints, cachés, tokens, tablas, migraciones ni políticas de consentimiento. No se activa monitoreo longitudinal ni la asociación sesión-conversación. La resolución seguirá fallando cerrada mientras el resultado exacto no esté disponible en servidor.
