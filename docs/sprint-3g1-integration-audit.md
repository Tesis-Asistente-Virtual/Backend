# Sprint 3G.1 — Auditoría de integración, consentimiento y flujos sensibles

## 1. Resumen ejecutivo

Esta auditoría inspeccionó rutas, composición, casos de uso, adaptadores, repositorios y pruebas existentes. No cambió código productivo ni datos.

Hallazgo prioritario de la auditoría 3G.1: los envíos REST y SSE no comprobaban `ai_conversation_processing`. Sprint 3G.2 incorporó un checker específico, una revalidación transaccional en la frontera de cada escritura y una revalidación antes del envío a OpenAI. La ejecución de esta etapa confirmó typecheck, build y pruebas unitarias; las pruebas PostgreSQL quedaron sin ejecutar porque `TEST_DATABASE_URL` no estaba configurada.

LongitudinalMonitoring comprueba la autorización vigente antes de iniciar, reanudar y crear sesiones. Sprint 3G.3 añade revalidación transaccional de aviso y último evento en las tres escrituras, serializada frente a decisiones Consent mediante el bloqueo de fila de cuenta. Esta ejecución confirma las pruebas unitarias; la integración PostgreSQL queda condicionada a disponer de `TEST_DATABASE_URL`.

PreliminaryAssessment sí complementa las comprobaciones de aplicación con revalidaciones transaccionales en los repositorios de escritura. Safety y ConversationalProcessing no están conectados al chat ni a rutas públicas; Safety no tiene detector ni adaptador de autorización productivos.

La presencia de controles técnicos no constituye aprobación clínica, jurídica ni autorización para un piloto con estudiantes.

## 2. Alcance y vocabulario de evidencia

- **Implementado:** observado directamente en el código.
- **Confirmado mediante pruebas:** hay pruebas automatizadas que cubren el comportamiento. En esta ejecución se revisaron archivos de pruebas, pero no se ejecutó PostgreSQL.
- **Pendiente:** requiere cambio, decisión, configuración o una ejecución no disponible.
- **Propuesto:** corrección o criterio recomendado, no implementado aquí.

No se usó `DATABASE_URL`, no se conectó a PostgreSQL, no se llamó a OpenAI, no se publicaron avisos ni se ejecutaron migraciones. `TEST_DATABASE_URL` no estaba configurada; por ello no se ejecutaron pruebas de integración.

## 3. Inventario de flujos

| Flujo | Entrada y autenticación | Propiedad / finalidad | Lectura, escritura y proveedor | Errores, cancelación y concurrencia | Estado |
| --- | --- | --- | --- | --- | --- |
| Crear conversación | `POST /api/v1/conversations`, JWT | `accountId` de `req.auth`; no requiere finalidad de IA para crear metadatos | Persiste título/estado; no llama a proveedor | Zod y errores HTTP; propietario delimitado | Implementado; pruebas REST |
| Listar/leer conversación y mensajes | GET de Conversations, JWT | Consultas delimitadas por `accountId`; 404 oculta propiedad ajena | Lee historial persistido; no llama a proveedor | Paginación y orden determinista | Implementado; unitarias e integración existentes |
| Enviar mensaje REST | `POST /:id/messages`, JWT | Comprueba propietario/estado bajo lock y exige `ai_conversation_processing` antes de escritura y antes de disclosure | Escritura de cada mensaje se coordina con decisiones Consent en transacción breve; contexto completado limitado enviado a OpenAI; respuesta persistida | Advisory lock por conversación; denegación inicial 403, checker no disponible 503; sin transacción durante generación | Implementado; unitarias confirmadas; PostgreSQL pendiente de ejecutar |
| Enviar mensaje SSE | `POST /:id/messages/stream`, JWT | Comprueba propietario/estado y consentimiento antes de iniciar headers; revalida en la escritura y antes de disclosure | Escritura coordinada transaccionalmente; emite deltas solo tras comprobación previa; respuesta final persistida antes de `message.completed` | Advisory lock compartido, `AbortSignal`; denegación inicial HTTP 403/503; tras iniciar SSE emite `stream.error` seguro; sin reanudación/idempotencia | Implementado; unitarias confirmadas; PostgreSQL pendiente de ejecutar |
| Registrar decisión Consent | `POST /api/v1/consents/me/decisions`, JWT | Finalidad del contrato; cuenta del JWT | Registra evento inmutable e idempotente, valida que el aviso exacto esté publicado/vigente | Transacción y bloqueo `auth_accounts FOR UPDATE`; clave idempotente | Implementado; integración existente |
| Consultar avisos/estado Consent | GET de Consent, JWT donde corresponde | Estado propio; finalidades independientes | Avisos publicados y vigentes; ausencia no concede autorización | El estado calculado distingue `not_decided`, `granted`, `declined`, `withdrawn`, `renewal_required` | Implementado; no se siembran avisos automáticamente |
| Extraer señales conversacionales | Caso de uso interno, sin ruta HTTP | Propiedad y consentimientos separados de extracción e IA, revalidados antes del extractor | Lee referencias propias/completadas y envía contexto mínimo al adaptador OpenAI; no persiste resultado | Falla cerrada, salida Zod; no está conectado al chat | Implementado internamente; no activado automáticamente |
| Evaluación preliminar | `/api/v1/preliminary-assessments`, JWT | `preliminary_assessment`, dueño por `accountId`, versión exacta del aviso | Respuestas persistidas; resultados actuales explícitamente no disponibles; no proveedor IA | Repositorios revalidan evento y aviso dentro de transacciones/bloqueos; CAS para estados y finalización | Implementado. No se verificó el contenido real de la base en esta auditoría |
| Enrollment/sesión longitudinal | `/api/v1/monitoring`, JWT | `longitudinal_monitoring`; propietario del enrollment | Solo metadatos de enrollment/sesión; no mediciones, mensajes ni tendencias | Check inicial más revalidación del aviso y último evento dentro de transacción; cuenta `FOR SHARE` antes de lock/update de enrollment; Consent usa cuenta `FOR UPDATE`; CAS e índices únicos conservados | Implementado; unitarias verificadas; integración PostgreSQL pendiente de configuración |
| Safety | No hay ruta ni registro en `app.ts` | Finalidad `safety_signal_processing` no existe en Consent | No se envía contenido; no hay detector productivo ni persistencia | Puerto de autorización sin adaptador productivo; deny-by-default disponible | Desactivado por composición; sin detector/dispatcher productivos |

## 4. Mapa de finalidades

| Finalidad | Definida en Consent | Usos observados | Límites |
| --- | --- | --- | --- |
| `ai_conversation_processing` | Sí | REST/SSE exige consentimiento explícito vigente; las escrituras se serializan frente a decisiones Consent | El consentimiento de otras finalidades no lo sustituye; el aviso real aún requiere aprobación jurídica/ética |
| `structured_signal_extraction` | Sí | Caso de uso interno requiere esta y `ai_conversation_processing`; adaptador OpenAI preparado | No se activa desde el chat ni se persiste resultado |
| `preliminary_assessment` | Sí | Inicio, respuestas, reanudación y finalización comprueban aviso/consentimiento | No equivale a instrumento clínico aprobado ni a diagnóstico |
| `longitudinal_monitoring` | Sí | Enrollment, reanudación y sesiones lo comprueban en aplicación | La revalidación no es atómica con todas las escrituras actuales |
| `safety_signal_processing` | No | Solo identificador propuesto en puerto Safety | No debe autorizarse mapeando otra finalidad |
| Acciones externas/contacto | No | No hay envío a terceros conectado | Requiere finalidad, base y protocolo independientes aprobados |

Consent impone un aviso publicado/vigente por finalidad y conserva decisiones como eventos. Una aceptación para una finalidad no otorga las demás. No se encontró proceso que publique avisos al arrancar.

## 5. Hallazgos y matriz de riesgos

La severidad expresa prioridad técnica antes de un piloto; no es una conclusión legal ni clínica.

| ID | Módulo y ruta | Evidencia concreta | Riesgo / condiciones | Severidad | Corrección propuesta y dependencias | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| G31-01 | Conversations `POST /api/v1/conversations/:id/messages` y `/stream` | Los casos de uso comprueban propietario/estado y `ai_conversation_processing`; el adaptador de mensajes bloquea la fila de cuenta `FOR SHARE`, consulta aviso/último evento y escribe en la misma transacción. Consent registra decisiones con `FOR UPDATE`. Se revalida antes de OpenAI. | Una revocación que obtiene primero el lock impide una nueva escritura. Si una escritura obtiene primero el lock, queda ordenada antes de la revocación. Una revocación posterior a la transferencia iniciada a OpenAI no puede deshacerla. | **Mitigado técnicamente; decisión de política pendiente** | Mantener cobertura concurrente PostgreSQL. Revisar aviso, UX/transición con frontend, política de historial/retención y tratamiento de transferencias ya iniciadas con revisión jurídica/ética. | Corrección implementada; verificada por unitarias. Integración PostgreSQL pendiente porque `TEST_DATABASE_URL` no estaba configurada. |
| G31-02 | LongitudinalMonitoring start/resume/session | Los repositorios `createWithCurrentConsent`, `saveStatusForOwnerWithCurrentConsent` y `createWithCurrentConsent` validan aviso publicado vigente y último evento dentro de la transacción de escritura. El orden es cuenta `FOR SHARE` → aviso `FOR SHARE` → enrollment (si aplica). Consent toma cuenta `FOR UPDATE` antes del aviso y la decisión. | Una retirada que confirma primero impide el write; un write que obtiene primero el lock de cuenta queda ordenado antes de la retirada. Las lecturas/historial posteriores y retención son una política distinta. | **Mitigado técnicamente; revisión de política pendiente** | Mantener pruebas concurrentes reales y aplicar la pauta a nuevas operaciones de escritura protegidas. Definir retención/acceso tras retiro con revisión jurídica y ética. | Implementado; unitarias verificadas. Integración PostgreSQL pendiente de conexión de pruebas. |
| G31-03 | PreliminaryAssessment creación, respuestas, reanudación y finalización | `DrizzlePreliminaryAssessmentRepository.create:72-88`, `saveForOwner:126-159`, `completeWithResultForOwner:174-201` y `DrizzleAssessmentResponseRepository.saveForOwner:33-90` consultan evento/aviso en transacción con bloqueo compartido de cuenta; `recordDecision:52` toma `FOR UPDATE`. | Riesgo residual de lock order/aislamiento requiere pruebas en DB, pero existe coordinación concreta de escritura frente a revocación. La lectura del resultado ya completado es idempotente y no vuelve a exigir consentimiento. | **Bajo / pendiente de caracterización** | Mantener pruebas de carrera entre withdraw y writes; definir si retirada afecta solo nuevo tratamiento o también acceso a datos históricos. Aprobación legal/ética para retención/acceso. | Protección transaccional implementada; el alcance de acceso histórico es decisión pendiente. |
| G31-04 | Consent notice publication | `consent` schema restringe finalidades y tiene índice de un aviso publicado por propósito; trigger de inmutabilidad en `drizzle/0003_deep_ender_wiggin.sql:36-63`. `getStatus` compara el evento más reciente con el aviso actual (`drizzle-consent-repository.ts:27-42`). | Una publicación/sustitución mal operada podría forzar renovación; no hay endpoint público de publicación observado. No se auditó un release administrativo separado. | **Media / proceso** | Definir y revisar el proceso de release que crea borrador, verifica hash, publica y sustituye; exigir revisión dual y auditoría de artefactos. Revisión jurídica de cada texto. | Restricciones de DB implementadas; gobernanza de publicación pendiente. |
| G31-05 | PreliminaryAssessment instrument catalog | El catálogo solo lista/recupera versiones aprobadas y vigentes y `isInstrumentAvailable` valida aprobación/licencia. Inicio retorna no disponible si no existe (`start-preliminary-assessment.ts:17-23`). No se hallaron seeds de instrumentos en código. | No se puede inferir el estado de instrumentos de una base sin consultarla; un operador con acceso de catálogo podría publicar una versión solo con referencias declarativas de aprobación/licencia. | **Media / aprobación** | No publicar versiones hasta validar instrumento, licencia, idioma/población, scoring y protocolo por profesional y titulares de derechos; separar facultad técnica de publicación. | Regla de acceso disponible en código; contenido real de DB no comprobado. |
| G31-06 | Safety composition | `app.ts:1-24` monta routers existentes y no importa Safety. `safety-ports.ts:42-58` declara autorización, propósito no soportado por Consent y deny-by-default; `safety/README.md` indica que no hay adaptador/detector/dispatch productivos. | Ninguno de los contratos por sí solo detecta peligro; no debe representarse como protección activa del chat. | **Media / comunicación** | Mantenerlo fuera de composición. Antes de activar, aprobar finalidad y aviso, política, detector, protocolo humano y pruebas de seguridad. Revisión psicológica, jurídica y ética. | Desactivación confirmada por código; no se prueba ausencia de procesos externos fuera del repo. |
| G31-07 | SSE, persistencia y reintentos de turno | `PostgresConversationTurnLock` mantiene advisory lock en una conexión dedicada hasta finalizar; el adaptador configura `maxRetries: 0` y timeout, `store:false`, `tools:[]`. Fallos persistidos como assistant `failed`; no hay idempotency key en el request. | Un cliente que reintenta tras desconexión puede crear un segundo mensaje user/turno; no se reanuda el stream previo. Una interrupción de proceso puede dejar solo user persistido. | **Media** | Para siguiente etapa, definir idempotencia de envío y recuperación de turnos; no prometer reanudación. Probar desconexión, timeout, restart/fallo de persistencia. | Sin idempotencia documentada en el contrato; concurrencia por conversación sí está protegida mientras el proceso/lock opera. |

## 6. Auditoría de conversaciones en detalle

- **Crear conversación:** JWT requerido; `accountId` sale del middleware. Se persisten metadatos/título. No se consulta Consent ni se envía contenido al proveedor. Un título libre puede ser sensible, por lo que no debe aparecer en logs.
- **Leer/listar historial:** consultas son por propietario y paginadas. El estado de consentimiento no bloquea acceso propio al historial; eso es distinto del permiso para tratamiento nuevo y debe quedar descrito en el aviso/política de datos.
- **REST de mensaje:** `SendConversationMessage` toma lock, confirma propietario/estado, exige `ai_conversation_processing`, inserta el mensaje user con una verificación transaccional del aviso vigente y el evento más reciente, arma contexto completado y limitado, revalida Consent justo antes de `generateText` y vuelve a verificarlo al persistir el resultado. El proveedor no se llama si falla la revalidación.
- **SSE:** valida auth/UUID/body antes de headers; bajo el lock, confirma owner/status y consentimiento antes de iniciar SSE. El mensaje user se inserta en una transacción que serializa frente a decisiones Consent. Antes de generar, revalida Consent; una denegación antes de headers es HTTP 403/503 y una denegación posterior se comunica con `stream.error` sin deltas/completado. `AbortSignal` cancela por desconexión; el lock PostgreSQL dedicado se libera en `finally`.
- **Proveedor:** SDK configurado con timeout, cero reintentos automáticos, `store:false` y `tools:[]`. El contexto limitado se origina en PostgreSQL. `store:false` no sustituye consentimiento, minimización, base jurídica ni política de retención.
- **Límite de revocación:** una operación de escritura y una decisión Consent se ordenan con el lock de la fila de cuenta. Si la escritura gana, queda confirmada antes del retiro; si el retiro gana, la escritura falla cerrada. Una revocación no puede retirar información ya transferida a OpenAI. La política de historial y retención tras retiro sigue pendiente.

## 7. Pruebas: existentes, caracterización y faltantes

Las pruebas inspeccionadas cubren owner scoping, JWT, respuestas SSE, cancelación, fallos del proveedor, locks, consistencia de persistencia, Consent idempotente, decisiones retiradas, extracción fail-closed, assessments y operaciones de monitoring. Se localizaron, entre otras, `tests/modules/conversations/send-conversation-message.test.ts`, `tests/modules/conversations/conversation-sse.test.ts`, `tests/integration/conversation-stream.integration.test.ts`, `tests/modules/conversational-processing/extract-authorized-conversation-signals.test.ts`, `tests/integration/preliminary-assessment.integration.test.ts` y `tests/integration/longitudinal-monitoring-http.integration.test.ts`.

Las regresiones unitarias cubren autorización ausente, checker fallido, revalidación, denegación REST/SSE y escrituras longitudinales enrutadas por el límite transaccional de Consent. La integración PostgreSQL contiene cobertura preparada para conversaciones y para enrollment, resume y sesión, incluido retiro concurrente; en esta ejecución 3G.3 no pudo correr porque `TEST_DATABASE_URL` no estaba configurada.

Se añadieron casos `todo` para esos contratos futuros en `tests/modules/security-sensitive-flows.pending.test.ts`. Son regresiones pendientes intencionales: no llaman a OpenAI ni alteran el comportamiento actual.

### Plan incremental de corrección

1. **G3G.2 — Consentimiento en conversaciones:** implementado en REST y SSE. Criterios pendientes de verificación PostgreSQL en `tesis_test_db`; revisar UX y aviso antes de adoptar el comportamiento en un entorno con usuarios.
2. **G3G.3 — Serialización de Consent y LongitudinalMonitoring:** implementado en creación de enrollment, reanudación y creación de sesiones. La integración caracteriza el resultado concurrente permitido para las tres; falta ejecutarla en `tesis_test_db` y revisar el resultado en ese entorno.
3. **G3G.4 — Política de historial/reintentos:** decisión explícita sobre acceso a datos tras retiro, retención/borrado, idempotencia del envío de mensajes y recuperación de turnos incompletos. Requiere revisión legal y ética.
4. **Antes de Safety o piloto:** finalidad propia en Consent, aviso aprobado, política profesional versionada, protocolo humano, responsabilidades, límites de intervención, pruebas de sesgo/errores y aprobación ética/jurídica. No basta con habilitar un adaptador.

## 8. Dependencias profesionales, jurídicas y éticas

- Validar el aviso de `ai_conversation_processing`, proveedor, propósito, datos compartidos, retención, derechos y retiro con asesoría jurídica/ética. Este informe no determina conformidad normativa.
- Psicología debe revisar lenguaje e instrucciones, instrumentos, interpretación y límites; ningún contrato o prueba técnica es validación clínica.
- Definir si la retirada impide nuevas operaciones únicamente o también cambia acceso, retención o eliminación de datos existentes.
- Safety requiere finalidad independiente, política aprobada, protocolo de incertidumbre y escalamiento humano; no contactar terceros automáticamente.
- Evaluar los términos vigentes del proveedor y el flujo de datos antes de un piloto. Ningún acceso real a cuentas o conversaciones formó parte de esta auditoría.

## 9. Cambios y verificaciones de esta ejecución

- Este documento se actualizó después de Sprint 3G.2 y 3G.3 para registrar los controles implementados y su estado de verificación.
- `npm run typecheck`: correcto; `npm run build`: correcto; `npm test`: 219 aprobadas y 1 `todo` no relacionada (LongitudinalMonitoring).
- `TEST_DATABASE_URL` no estaba configurada. No se usó `DATABASE_URL` ni se intentó una conexión PostgreSQL; la suite de integración queda pendiente.
- No se realizaron solicitudes a OpenAI ni se modificaron `.env`, migraciones o datos PostgreSQL en Sprint 3G.2/3G.3.

## 10. Historial

| Versión | Estado | Cambio |
| --- | --- | --- |
| 1.0 | Inspección técnica | Mapa inicial de flujos y riesgos de integración/consentimiento. |
| 1.1 | Seguimiento Sprint 3G.2 | Consentimiento de procesamiento IA exigido en REST/SSE; revalidación de escrituras coordinada con Consent y documentación de pruebas pendientes. |
| 1.2 | Seguimiento Sprint 3G.3 | Revalidación transaccional y orden de locks para enrollment, reanudación y sesiones; se documenta la integración PostgreSQL pendiente de entorno. |
