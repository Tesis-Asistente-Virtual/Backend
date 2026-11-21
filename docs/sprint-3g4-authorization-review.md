# Sprint 3G.4 — Auditoría final de autorización

**Fecha de inspección:** 2026-11-21  
**Alcance:** lectura de código, documentación y pruebas existentes. No se modificaron rutas, lógica de producción, configuración, esquema ni datos.

## 1. Resumen ejecutivo

La composición actual monta Authentication, Users, Conversations, Consent & Privacy, PreliminaryAssessment y LongitudinalMonitoring. ConversationalProcessing no tiene ruta ni está conectado automáticamente al chat. Safety no está registrado en `app.ts`, no tiene detector productivo ni dispatcher activo, y la finalidad `safety_signal_processing` no está admitida por Consent.

Conversations REST y SSE exigen JWT, acotan la propiedad por `accountId`, requieren `ai_conversation_processing` y revalidan consentimiento en los límites de persistencia y antes de transferir el contexto a OpenAI. LongitudinalMonitoring requiere su propia finalidad al crear, reanudar y abrir sesiones; sus adaptadores vuelven a validar aviso vigente y último evento dentro de transacciones coordinadas con decisiones Consent.

**Hallazgo detectado en 3G.4, corregido en 3G.5 y validado:** la reanudación, finalización y escritura de respuestas ahora revalidan el consentimiento y el aviso dentro de la transacción. La validación bloquea primero la cuenta y luego el aviso actualmente publicado con `FOR SHARE`, confirma finalidad, vigencia efectiva y concesión más reciente asociada exactamente a ese aviso, y después bloquea/escribe la evaluación. Esto ordena retiro y sustitución del aviso frente a la operación protegida. En Sprint 3G.5 se aprobaron **17 pruebas PostgreSQL de PreliminaryAssessment**, que cubren aviso vigente, sustitución previa y carreras de sustitución con reanudación, respuesta y finalización. G34-01 ya no es una vulnerabilidad activa.

Las verificaciones unitarias, build y typecheck se reportan por ejecución en el cierre del sprint. En la auditoría original 3G.4, la cifra previa era de 61 integraciones en 9 archivos y no se consultó PostgreSQL. La actualización posterior de 3G.5 agregó y ejecutó las regresiones de Assessment: 17 pruebas PostgreSQL aprobadas en ese módulo. Este documento no constituye aprobación clínica, ética, jurídica ni autorización para un piloto.

## 2. Método y límites de evidencia

- **Implementado:** comprobado leyendo el código y la composición actual.
- **Cubierto por prueba existente:** se encontró una prueba que ejercita el comportamiento; esto no afirma que se haya ejecutado en esta tarea.
- **Pendiente:** falta una decisión, una protección, una prueba o una verificación de entorno.
- **Propuesta:** recomendación para un incremento posterior, no implementada aquí.

La auditoría se basó en `src/app.ts`, routers y controllers, casos de uso, adaptadores de persistencia y consentimiento, esquemas, documentos 3G.1 y Safety, y pruebas de `tests/modules` y `tests/integration`. No se consultó PostgreSQL, no se llamó a OpenAI y no se inspeccionó un despliegue externo. Por tanto, no se afirma qué avisos o instrumentos existen actualmente en una base de datos.

## 3. Inventario de rutas

`accountId` significa la identidad obtenida del JWT por el middleware, salvo donde se indica que la ruta es pública o utiliza un refresh token. “Sin finalidad” significa que el endpoint no invoca esa finalidad de tratamiento; no es una conclusión legal sobre la base del almacenamiento operativo.

| Método y ruta | Módulo / operación | Auth y propietario | Finalidad / punto de control | Datos y persistencia / proveedor | Prueba existente y observación |
|---|---|---|---|---|---|
| `GET /health` | Salud técnica | Pública | Ninguna | Estado del proceso; sin datos de estudiante | Health check existente |
| `POST /api/v1/auth/sign-up` | Authentication, alta | Pública | Ninguna | Email y hash de contraseña; crea cuenta y perfil | `signup-users.integration.test.ts` |
| `POST /api/v1/auth/sign-in` | Authentication, inicio | Pública; rate limit local | Ninguna | Credenciales; devuelve tokens | `sign-in.test.ts`; el limitador observado es por proceso |
| `POST /api/v1/auth/refresh` | Authentication, refresh | Refresh token en body; rate limit local | Ninguna | Rota/revoca sesión y emite tokens | `refresh-session.test.ts`, incluida carrera de refresh |
| `POST /api/v1/auth/sign-out` | Authentication, cierre | Refresh token en body; rate limit local | Ninguna | Revoca sesión | `refresh-session.test.ts` |
| `GET /api/v1/users/me` | Users, perfil propio | JWT; cuenta del token | Ninguna | Lee perfil propio | Router protegido; prueba en integración de usuarios |
| `PATCH /api/v1/users/me` | Users, actualizar perfil | JWT; cuenta del token | Ninguna | Actualiza perfil propio | Router protegido; prueba en integración de usuarios |
| `POST /api/v1/conversations` | Conversations, crear | JWT; cuenta del token | No procesa IA | Persiste título y metadatos. El título es texto libre y puede ser sensible | `conversations.integration.test.ts`; política para título/retención pendiente |
| `GET /api/v1/conversations` | Conversations, listar | JWT; query por propietario | Ninguna | Lista metadatos paginados | Pruebas de aislamiento/paginación en `conversations.integration.test.ts` |
| `GET /api/v1/conversations/:id` | Conversations, detalle | JWT; query por propietario, ajena/no existente no se revela | Ninguna | Lee metadatos | Prueba de acceso por propietario |
| `GET /api/v1/conversations/:id/messages` | Conversations, historial | JWT; query por propietario | Ninguna comprobación de finalidad en lectura | Lee contenido persistido; no llama proveedor | Pruebas de mensajes/aislamiento. Acceso al historial tras retiro es una decisión de política abierta |
| `POST /api/v1/conversations/:id/messages` | Conversations, envío REST | JWT; verifica propietario y estado | `ai_conversation_processing`: check inicial; insert de mensaje revalida aviso/evento transaccionalmente; vuelve a comprobar antes de transferir contexto a OpenAI | Persiste mensaje user; envía contexto limitado de mensajes completados a OpenAI (`store:false`, `tools:[]`); persiste respuesta o estado fallido | `send-conversation-message.test.ts`; integración incluye retiro concurrente y bloqueo sin consentimiento |
| `POST /api/v1/conversations/:id/messages/stream` | Conversations, envío SSE | JWT; verifica propietario/estado antes de iniciar SSE | Misma finalidad; check antes de headers, revalidación transaccional al persistir y antes del proveedor | Emite deltas y persiste respuesta final; cancelación por desconexión; no transacción durante generación | `conversation-stream.integration.test.ts`: flujo incremental, lock REST/SSE, 404 propietario, denegación sin mensajes/proveedor |
| `GET /api/v1/consents/notices` | Consent, avisos disponibles | Pública | No concede autorización | Expone avisos publicados vigentes | `consent.integration.test.ts`; no se encontró ruta para publicar avisos |
| `GET /api/v1/consents/me` | Consent, estado propio | JWT; cuenta del token | Consulta todas las finalidades independientemente | Devuelve `not_decided`, `granted`, `declined`, `withdrawn` o `renewal_required` según versión/último evento | Unitarias e integración Consent |
| `POST /api/v1/consents/me/decisions` | Consent, grant/decline/withdraw | JWT; cuenta del token, nunca body | Finalidad y versión expresas; aviso debe estar publicado y vigente | Agrega evento inmutable; idempotencia por clave; serializa decisión con lock de cuenta | Integración Consent: acciones, versión, idempotencia y concurrencia |
| `GET /api/v1/preliminary-assessments/info` | PreliminaryAssessment, disponibilidad | JWT | No inicia evaluación | Catálogo expone solo versiones consideradas disponibles | Prueba HTTP del ciclo; el contenido actual de DB no se consultó |
| `POST /api/v1/preliminary-assessments` | PreliminaryAssessment, inicio | JWT; asigna dueño desde token | `preliminary_assessment` en aplicación y transacción de creación; confirma instrumento disponible antes de crear | Persiste evaluación y referencia a aviso/instrumento; sin OpenAI | `preliminary-assessment.integration.test.ts`: consentimiento requerido y creación/propiedad |
| `GET /api/v1/preliminary-assessments` | PreliminaryAssessment, historial | JWT; listado owner-scoped | Sin revalidación de consentimiento para lectura | Lee evaluaciones/respuestas | Integración de propiedad; acceso histórico tras retiro pendiente de política |
| `GET /api/v1/preliminary-assessments/:id` | PreliminaryAssessment, detalle | JWT; owner-scoped | Sin revalidación para lectura | Lee evaluación y respuestas | Integración de ciclo/propiedad |
| `POST /api/v1/preliminary-assessments/:id/responses` | PreliminaryAssessment, respuesta | JWT; dueño comprobado | Check de finalidad en aplicación; repositorio revisa dentro de transacción cuenta, estado/versión, aviso publicado/vigente y último evento | Persiste respuesta JSON validada del instrumento; no OpenAI | Integración de versión, respuestas y retirada |
| `POST /api/v1/preliminary-assessments/:id/pause` | PreliminaryAssessment, pausa | JWT; owner-scoped | No exige consentimiento vigente para pausar | Cambia estado, CAS por `updatedAt` | Pruebas de transición/CAS |
| `POST /api/v1/preliminary-assessments/:id/resume` | PreliminaryAssessment, reanudación | JWT; owner-scoped | Check inicial más cuenta/aviso actual y concesión exacta dentro de transacción | Cambia estado mediante CAS | Cubierto por pruebas unitarias e integración de aviso vigente/sustituido y concurrencia; 17 pruebas PostgreSQL del módulo aprobadas en 3G.5 |
| `POST /api/v1/preliminary-assessments/:id/withdraw` | PreliminaryAssessment, retiro | JWT; owner-scoped | Permitido sin consentimiento vigente | Cambia estado; no elimina respuestas | Pruebas de transición; política de retención posterior pendiente |
| `POST /api/v1/preliminary-assessments/:id/complete` | PreliminaryAssessment, finalizar | JWT; owner-scoped | Check inicial más cuenta/aviso actual y concesión exacta dentro de transacción | Finaliza y crea resultado único, actualmente no disponible | Atomicidad/idempotencia y regresión de aviso sustituido/concurrencia; incluida en las 17 pruebas PostgreSQL aprobadas en 3G.5 |
| `GET /api/v1/preliminary-assessments/:id/result` | PreliminaryAssessment, resultado | JWT; owner-scoped | Sin revalidación para lectura | Lee resultado con estados `not_available` | Prueba HTTP de resultado no disponible; política tras retiro pendiente |
| `GET /api/v1/monitoring/info` | LongitudinalMonitoring, información | JWT | No inscribe ni recopila mediciones | Metadatos de disponibilidad | Pruebas HTTP del módulo |
| `POST /api/v1/monitoring/enrollments` | LongitudinalMonitoring, inicio | JWT; dueño desde token | `longitudinal_monitoring`: check inicial y transaccional contra aviso vigente/último evento | Persiste metadatos de inscripción; nada de síntomas | `longitudinal-monitoring.integration.test.ts`: write boundaries y concurrencia retiro |
| `GET /api/v1/monitoring/enrollments` | LongitudinalMonitoring, listar | JWT; owner-scoped | Sin nueva comprobación para lectura | Lee metadatos | Integración de propiedad |
| `GET /api/v1/monitoring/enrollments/:id` | LongitudinalMonitoring, detalle | JWT; owner-scoped | Sin nueva comprobación para lectura | Lee metadatos | Integración de propiedad |
| `POST /api/v1/monitoring/enrollments/:id/pause` | LongitudinalMonitoring, pausa | JWT; owner-scoped | No requiere consentimiento nuevo | Cambio de estado con revisión de versión | Integración de transiciones |
| `POST /api/v1/monitoring/enrollments/:id/resume` | LongitudinalMonitoring, reanudar | JWT; owner-scoped | Check inicial y transaccional de `longitudinal_monitoring` | Cambio de estado con CAS | Integración de revalidación/retiro concurrente |
| `POST /api/v1/monitoring/enrollments/:id/withdraw` | LongitudinalMonitoring, retiro | JWT; owner-scoped | No exige consentimiento vigente; mantiene disponible el retiro | Cambio de estado, sin borrar histórico | Integración de estados; retención posterior pendiente |
| `POST /api/v1/monitoring/enrollments/:id/complete` | LongitudinalMonitoring, completar | JWT; owner-scoped | No inicia nueva medición | Cambio de estado | Prueba de transiciones |
| `POST /api/v1/monitoring/enrollments/:id/sessions` | LongitudinalMonitoring, crear sesión | JWT; enrollment owner-scoped | Check inicial y transaccional de finalidad vigente | Persiste metadatos temporales de sesión, no observaciones | Integración de sesión y retiro concurrente |
| `GET /api/v1/monitoring/enrollments/:id/sessions` | LongitudinalMonitoring, listar sesiones | JWT; owner-scoped | Sin nueva comprobación para lectura | Lee metadatos | Integración de propiedad |

No se encontraron endpoints HTTP de Safety ni de extracción estructurada. Los recursos de OpenAPI y `/api-docs` no son operaciones de datos personales; `/health` solo devuelve estado técnico.

## 4. Matriz de finalidades Consent

| Finalidad técnica | Está en Consent | Rutas/uso observados | Estado y límite |
|---|---:|---|---|
| `ai_conversation_processing` | Sí | REST/SSE de envío de mensajes | Check explícito y revalidaciones. Aviso real, alcance de proveedor y política de conservación requieren aprobación externa |
| `structured_signal_extraction` | Sí | Caso de uso interno `ExtractAuthorizedConversationSignals` | Exige también `ai_conversation_processing`; no hay ruta ni conexión automática al chat; no persiste observaciones |
| `preliminary_assessment` | Sí | Inicio, respuesta, reanudación, finalización | Resume, respuesta y complete revalidan aviso vigente y último grant en la transacción; ver actualización 3G.5 |
| `longitudinal_monitoring` | Sí | Inicio, reanudación, creación de sesión | Revalidación transaccional; no habilita medición automática |
| `safety_signal_processing` | **No** | Solo aparece como propuesta en contratos/documentación Safety | No debe mapearse a otra finalidad; autorización deny-by-default y módulo fuera de composición |
| Acciones externas/contacto | **No** | Ninguna ruta/despachador operativo | No se autoriza ni implementa; necesitaría fundamento, consentimiento/protocolo y revisión separados |

El estado se deriva del aviso vigente y del evento más reciente de esa cuenta/finalidad. Grant, decline y withdrawal son eventos históricos; ausencia de evento no concede permiso. Las decisiones se atan al aviso exacto. El retiro no elimina por sí solo datos previamente guardados. No hay endpoint de publicación de avisos en la API examinada.

## 5. Hallazgos y riesgos priorizados

La prioridad representa riesgo técnico previo a cualquier piloto, no severidad clínica ni conclusión jurídica.

| ID / prioridad | Evidencia y riesgo | Condición | Corrección o decisión pendiente |
|---|---|---|---|
| **G34-01 — Alta en 3G.4; corregido y validado en 3G.5** | Los adaptadores llaman a `requireCurrentPreliminaryAssessmentConsent`: bloquean `auth_accounts FOR SHARE`, seleccionan el aviso publicado/vigente de `preliminary_assessment FOR SHARE`, leen el evento más reciente y exigen `granted` con el mismo ID; comparan además el ID guardado en la evaluación. Inicio, respuesta, resume y complete revalidan en la transacción antes de escribir. | La escritura mantiene el lock del aviso hasta commit. Una sustitución iniciada primero se observa como aviso nuevo/no coincidente y deniega; si la escritura bloquea primero, la sustitución espera y queda ordenada después. | Corrección implementada sin cambio de esquema. Las regresiones unitarias y **17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5** verifican aviso vigente, sustitución previa, denegación sin efectos y las serializaciones de sustitución con resume/respuesta/complete. Estado: corregido y validado; no es una vulnerabilidad activa. |
| **G34-02 — Alta, aprobación profesional/jurídica** | No se halló política de retención, borrado, acceso histórico tras retiro ni tratamiento de respaldos aprobada en el código/documentos técnicos revisados. Hay texto de mensajes, respuestas JSON y metadatos sensibles persistidos. | Cualquier uso con personas reales o gestión de solicitudes de acceso/supresión. | Resolver política de finalidad, minimización, retención, supresión, copias, incidentes y acceso con asesoría jurídica/ética e institución antes de piloto. |
| **G34-03 — Alta, aprobación clínica/metodológica** | No se verificó un instrumento aprobado en una base (no se consultó DB). Código requiere metadatos de aprobación/licencia; resultado actual se marca `not_available`. Safety carece de detector/política productivos. | Activación de evaluación, interpretación, clasificación o seguridad. | Aprobación documentada de instrumento, licencia, versión, población/idioma, reglas, validación, límites y supervisión profesional. No inferir disponibilidad real de DB desde este informe. |
| **G34-04 — Media, política de producto y privacidad** | Las lecturas autenticadas de historial y resultados no exigen consentimiento actual; crear conversación guarda título libre sin finalidad de IA. Esto puede ser intencional para acceso propio/continuidad, pero el código no define el efecto de retiro sobre lectura ni metadatos existentes. | Retiro de consentimiento o solicitud de eliminación/acceso. | Definir conducta explícita y comunicarla; no tratar retirada como borrado automático ni como permiso para nuevos procesamientos. |
| **G34-05 — Media, gobernanza de avisos** | El esquema hace inmutables contenido publicado y eventos; admite sustitución controlada y un solo aviso publicado por finalidad. No se encontró ruta de publicación; el mecanismo operativo/de release no se auditó. | Publicar o sustituir aviso en despliegues. | Proceso revisado con aprobación legal/ética, hash verificable, revisión dual, trazabilidad y rollback controlado. |
| **G34-06 — Media, cobertura de pruebas; validado en 3G.5** | La regresión de supersession para resume/respuesta/complete está en `tests/integration/preliminary-assessment.integration.test.ts`; observa bloqueos PostgreSQL reales mediante `pg_stat_activity` y no depende de una pausa temporal fija. | La cifra de ejecución es evidencia histórica del ciclo 3G.5; una repetición futura requiere verificar `TEST_DATABASE_URL` contra `tesis_test_db`. | **17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5.** La ejecución no se repitió en la actualización documental actual. |
| **G34-07 — Baja/arquitectura preventiva** | Los puertos/repositorios ofrecen operaciones de persistencia generales además de variantes que revalidan Consent. Los routers actuales conectan los casos de uso previstos, pero una futura invocación interna podría elegir el método menos protegido. | Nuevo caso de uso o job interno llama directamente al puerto genérico. | Reducir superficie de bypass en un cambio acotado futuro (contratos más específicos/servicios autorizados), con pruebas de arquitectura; no se observó ruta externa que explote esto hoy. |
| **G34-08 — Media, semántica de turno parcial** | El envío REST persiste primero el mensaje del estudiante y vuelve a comprobar consentimiento antes de transferir el contexto al proveedor. Si el consentimiento se retira entre ambos pasos, el envío a OpenAI se detiene pero el mensaje ya confirmado puede permanecer en el historial. La serialización cuenta-write/withdraw lo ordena antes del retiro; no es una transferencia posterior al retiro. | Retiro concurrente después de confirmar la inserción del mensaje user y antes del check previo a OpenAI. | Documentar este resultado y acordar con revisión jurídica/ética la semántica de mensaje ya aceptado por el servidor. Conservar la prueba de que no hay transferencia al proveedor; considerar prueba explícita del mensaje residual. No borrar automáticamente eventos/datos al retirar. |

## 6. Datos, proveedor, logs y ciclo de vida

| Categoría | Hecho técnico observado | Pendiente / límite |
|---|---|---|
| Identidad y autenticación | `auth_accounts` guarda email y hash de contraseña; sesiones almacenan material de sesión protegido/revocable. Rutas propias obtienen `accountId` de JWT. | Retención, borrado de cuenta y tratamiento de respaldos requieren política revisada. |
| Perfil | Perfil contiene campos de nombre y teléfono opcionales. | Minimización y necesidad de cada campo para el estudio deben justificarse. |
| Conversations | Guarda títulos y contenido de mensajes; es historial fuente para generación. | Política de acceso tras retiro, retención, eliminación, exportación y revisión de título libre. No hay idempotencia/reanudación del turno indicada en el flujo SSE. |
| OpenAI | Generación de conversación usa Responses API con `store:false`, `tools:[]`, contexto limitado y no usa conversación remota como fuente de verdad. | `store:false` no constituye consentimiento ni determina por sí solo todas las prácticas/retención del proveedor; revisar contrato, región/transferencia, controles y aviso vigente. No hubo llamada real en esta tarea. |
| PreliminaryAssessment | Almacena respuestas validadas (JSON) y resultados; resultado actual explícitamente no disponible. | No se consultó catálogo de la DB. Aprobar instrumento/licencia, reglas, acceso, retención y supresión. G34-01 está corregido y validado; las limitaciones clínicas y de ciclo de vida continúan pendientes. |
| LongitudinalMonitoring | Persisten enrollment/session y metadatos de tiempo/estado; no se encontraron tablas de mediciones en el alcance revisado. | Confirmar mediante migraciones/esquema en cada release; no interpretar sesiones como mediciones o seguimiento automático. |
| Consent | Avisos almacenan contenido/hash; decisiones append-only con propósito, versión, acción, cuenta e idempotency key. | Definir acceso a evidencias, retención y trazabilidad administrativa; no se creó/publicó aviso. |
| Safety | No se detecta ni persiste nada en producción; sin ruta/dispatcher. | Aprobación específica y separada antes de cualquier procesamiento o acción. |
| Logs | Observador SSE registra categorías técnicas cerradas; error handler emite mensaje fijo, sin stack mostrado en respuesta. En el código revisado no se observó logging deliberado de contenido/prompt/API key. | Revisar configuración de infraestructura (proxy, APM, retención de stdout, trazas, backups y proveedor), fuera de este repositorio. No se verificó un despliegue real. |

El esquema aplica cascadas de algunas relaciones y restricciones de integridad, pero no equivale a una política de supresión completa: deben verificarse referencias, backups, exportaciones y obligaciones jurídicas antes de definir un procedimiento de borrado.

## 7. Evidencias de prueba revisadas

Estos nombres se encontraron en el código de pruebas; no significan que todas se ejecutaran en esta auditoría.

| Garantía | Evidencia localizada |
|---|---|
| Consent explícito, finalidad aislada, aviso superseded | `tests/modules/consent/consent.test.ts`; `tests/integration/consent.integration.test.ts` |
| Conversación: ausencia de consentimiento no escribe ni llama proveedor; revalidación previa a proveedor; denegación tras retiro | `tests/modules/conversations/send-conversation-message.test.ts`; `tests/integration/conversation-stream.integration.test.ts`; `tests/integration/conversations.integration.test.ts` |
| SSE progresivo, cierre/error, lock compartido REST/SSE y propiedad | `tests/integration/conversation-stream.integration.test.ts` |
| Propiedad y ciclo HTTP de evaluación, respuestas/versiones, resultado unavailable, concurrencia de finalización y respuestas | `tests/integration/preliminary-assessment.integration.test.ts` |
| Enrollment/sesión: write boundary tras retiro y before-or-after concurrente | `tests/integration/longitudinal-monitoring.integration.test.ts`; `tests/integration/longitudinal-monitoring-http.integration.test.ts` |
| Extracción no conectada automáticamente; doble finalidad y revalidación antes del extractor | `tests/integration/conversational-processing.integration.test.ts` |
| Ausencia de rutas Safety y deny-by-default | Inspección de `src/app.ts`, `src/modules/safety/README.md` y puertos; no es prueba HTTP automatizada de ausencia de composición |

**Cobertura pendiente:** prueba de acceso/historial luego del retiro, según la política que se apruebe, y pruebas del proceso de publicación de avisos cuando se defina. La brecha G34-01 ya tiene regresiones unitarias y PostgreSQL: 17 pruebas de integración de PreliminaryAssessment aprobadas en 3G.5, incluidas sustitución previa y concurrencia con operaciones protegidas.

## 8. Requisitos previos a cualquier piloto

### Profesionales y metodológicos

- Instrumento específico validado para población, idioma y uso propuesto, con autorización/licencia y versión aprobada.
- Reglas de interpretación, límites, incertidumbre, resultados no disponibles y revisión humana aprobados por profesional responsable.
- Protocolo Safety independiente, con criterios, roles, cobertura, contingencia por falla y recursos humanos realmente disponibles; no inferir que el backend ofrece monitoreo de emergencia.
- Revisión de guiones empáticos y proceso para fallos, incompletitud, mensajes ambiguos o contradictorios.
- Diseño de validación, métricas, sesgo, criterios de parada y supervisión del piloto.

### Jurídicos, éticos e institucionales

- Revisión de finalidad y aviso exacto por tratamiento, separado de investigación, incluyendo proveedor, destinatarios, transferencias, derechos, consecuencias de retiro y límites de confidencialidad.
- Aprobaciones institucionales/éticas y base jurídica aplicable al tratamiento de datos sensibles; no se afirma cumplimiento de la Ley 29733 ni de su reglamento.
- Políticas aprobadas de minimización, retención, eliminación, respaldos, acceso, incidentes y solicitudes de titulares.
- Revisión de acuerdos y medidas de privacidad/seguridad del proveedor, junto con información transparente a participantes.
- Decisión formal sobre acceso a información histórica tras retiro y sobre títulos libres de conversación.

## 9. Bloqueos priorizados y plan de corrección

1. **Gobernanza y datos:** acordar aviso/retención/supresión/acceso tras retiro y el proceso de publicación; revisar configuración de logs y proveedor fuera del código.
2. **Aprobación profesional:** instrumento, licencia, idioma/población, reglas/resultados y supervisión; no presentar Assessment como evaluación clínica activa.
3. **Mantener Safety y extracción fuera de producción:** finalidad Safety no está autorizada ni conectada; extracción sigue interna/no automática.
4. **Antes de activación gradual:** integrar evidencia de consentimiento en frontend/UX, realizar revisión de seguridad y privacidad del despliegue y aprobar plan de parada y monitoreo operativo. G34-01 no forma parte de los bloqueos abiertos; su corrección está validada por las 17 pruebas PostgreSQL de Assessment de 3G.5.

## 10. Criterios de aceptación para futuras activaciones

- Cada endpoint/caso de uso sensible tiene finalidad explícita, cuenta derivada de contexto autenticado y prueba de aislamiento.
- El check de aplicación y revalidación atómica se producen antes de cada escritura protegida y antes de cada transferencia a terceros; la revocación y sustitución tienen pruebas de carrera deterministas.
- No hay eventos de éxito ni respuestas completadas ante denegación, error, cancelación o persistencia fallida.
- El retiro bloquea futuras operaciones de la finalidad conforme a política y no se presenta como borrado retroactivo.
- Avisos/versiones, reglas e instrumentos tienen aprobación verificable y proceso de publicación controlado.
- Logs, telemetría, backups, exportación, retención y supresión se revisan de extremo a extremo, no solo en el código de aplicación.
- Revisión profesional, jurídica, ética e institucional documentada; seguridad y supervisión humana operables; pruebas unitarias e integración aprobadas en ambiente aislado.
- Activación se realiza mediante cambio revisado y reversible, no por configuración incidental.

## 11. Separación de hechos y propuestas

**Implementado y observado:** rutas y middleware listados; consentimiento por finalidades independientes; verificación/revalidación de Conversations y LongitudinalMonitoring; respuestas de evaluación no disponibles; estructura de datos descrita; Safety no registrado ni activo.

**Cubierto por pruebas localizadas:** consentimiento, propiedad, persistencia, cancelación/errores de conversación, revalidación de finalidad conversacional y longitudinal, aislamiento e idempotencia según pruebas citadas.

**Hallazgo histórico G34-01:** detectado en 3G.4; corregido en 3G.5 mediante revalidación transaccional del grant y del aviso publicado vigente para inicio, respuesta, reanudación y finalización. **Validación:** 17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5, incluidas versiones sustituidas y serializaciones concurrentes. G34-01 está cerrado y no se considera una vulnerabilidad activa.

**Propuesto, aún no implementado:** controles de gobernanza/publicación; políticas de retención y decisión de historial tras retiro; futuros criterios de activación.

**No confirmado por esta auditoría:** contenido real de bases de datos o avisos/instrumentos publicados, configuración de infraestructura de logging/proxy, políticas del proveedor en el despliegue, cumplimiento legal, validación clínica o preparación del backend para un piloto.

## 12. Fuentes internas consultadas

- `src/app.ts`
- `src/modules/authentication/interfaces/rest/` (routers y OpenAPI)
- `src/modules/users/interfaces/rest/`
- `src/modules/conversations/interfaces/rest/`, `application/internal/command-services/`, `infrastructure/persistence/` y `infrastructure/openai/`
- `src/modules/consent/domain/`, `application/`, `infrastructure/persistence/` e `interfaces/rest/`
- `src/modules/preliminary-assessment/application/`, `infrastructure/persistence/` e `interfaces/rest/`
- `src/modules/longitudinal-monitoring/application/`, `infrastructure/persistence/` e `interfaces/rest/`
- `src/modules/conversational-processing/application/` e `infrastructure/openai/`
- `src/modules/safety/README.md`, puertos, orquestador y `docs/safety-review-matrix.md`
- `docs/sprint-3g1-integration-audit.md`
- Pruebas listadas en la sección 7

## 13. Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 2026-11-21 | Auditoría final de rutas, finalidades, revalidación, datos, pruebas y bloqueos previos a validación profesional. |
| 1.1 | 2026-11-21 | Actualización 3G.5: revalidación transaccional de aviso vigente para evaluación; pruebas unitarias e integración añadidas; integración condicionada a `TEST_DATABASE_URL`. |
| 1.2 | 2026-11-21 | Cierre de G34-01: se registra como corregido en 3G.5 y validado por 17 pruebas PostgreSQL de PreliminaryAssessment aprobadas; se actualizan las referencias que aún lo presentaban como pendiente. |

## 14. Evidencia de implementación Sprint 3G.5

- `requireCurrentPreliminaryAssessmentConsent` valida `preliminary_assessment`, grant más reciente y aviso publicado/efectivo exacto dentro de la transacción; toma locks en orden cuenta → aviso.
- El helper se utiliza al crear, guardar una respuesta, reanudar y finalizar. Las escrituras sobre filas/resultados ocurren después de validar. Pausa y retiro permanecen disponibles sin autorización vigente para permitir detener/retirar la participación.
- Se añadieron regresiones unitarias y pruebas PostgreSQL para aviso vigente, sustitución previa y las dos serializaciones posibles entre sustitución y resume/response/complete. Las pruebas de concurrencia observan espera real por lock mediante `pg_stat_activity` con timeout acotado.
- Verificación Sprint 3G.5: typecheck, build y 222 pruebas unitarias aprobadas; **17 pruebas PostgreSQL de PreliminaryAssessment aprobadas**, incluidas las regresiones de aviso sustituido y concurrencia. La mención de que no se consultó PostgreSQL describe exclusivamente la auditoría original 3G.4, anterior a esta validación.
- La limitación de retención/acceso histórico tras retiro y las aprobaciones profesionales/jurídicas descritas arriba continúan pendientes.
