# Cierre técnico del Sprint 3

**Inspección:** 2026-11-21  
**Estado:** cierre de infraestructura técnica, sujeto a las verificaciones y límites anotados abajo. No es aprobación para producción, piloto con estudiantes ni validación clínica.

## Resumen

La composición DDD mantiene separados Consent & Privacy, ConversationalProcessing, PreliminaryAssessment, Safety y LongitudinalMonitoring. Conversations REST/SSE y los flujos habilitados de evaluación/monitoreo comprueban la finalidad de consentimiento correspondiente. ConversationalProcessing y Safety no están montados en `src/app.ts`; el primero conserva un caso de uso/adaptador invocable internamente, mientras Safety permanece sin detector productivo ni despacho de acciones. No se encontraron rutas que activen extracción estructurada o monitoreo automático.

En esta ejecución, `npm run typecheck`, `npm run build` y `npm test` terminaron correctamente; Vitest reportó 222 pruebas en 28 archivos. No se ejecutó la suite PostgreSQL: `TEST_DATABASE_URL` no estaba definida. Las 70 integraciones en 9 archivos son el resultado previo reportado por el proyecto, no una ejecución de esta revisión. No se consultó ninguna base de datos ni se llamaron servicios OpenAI.

## Convención de evidencia

- **Implementado:** comprobado en el código inspeccionado.
- **Probado en esta ejecución:** resultado observado al correr un comando en esta revisión.
- **Reportado previamente:** cifra/contexto comunicado por el proyecto, no repetido aquí.
- **Desactivado:** código/infraestructura existe parcialmente, pero no hay registro o flujo activo en producción.
- **Pendiente de aprobación:** requiere decisión profesional, jurídica, ética o institucional.

## Matriz de módulos

| Bounded Context | Implementado | Estado de activación | Evidencia revisada | Pendiente principal |
|---|---|---|---|---|
| Consent & Privacy | Avisos versionados, eventos explícitos `granted`/`declined`/`withdrawn`, consulta de estado e idempotencia; finalidades separadas | Operativo para las rutas y casos de uso conectados; no se publicaron avisos en esta tarea | Esquema, repositorio, casos de uso y rutas `/api/v1/consents/*` | Aprobación del contenido, publicación gobernada, retención y revisión jurídica/ética |
| ConversationalProcessing | Contratos Zod versionados, puerto, adaptador OpenAI de extracción y orquestación con doble finalidad y control de propiedad | **Desactivado respecto del chat y rutas**; no hay persistencia de observaciones | Módulo y composición en `src/app.ts`; sin ruta de extracción | Revisión profesional y jurídica de finalidad, minimización y uso del proveedor antes de conexión |
| PreliminaryAssessment | Dominio, instrumentos versionados, respuestas, repositorios, API, propiedad y revalidación transaccional de consentimiento | Rutas disponibles; inicio queda bloqueado si no hay instrumento aprobado vigente y consentimiento válido. No se confirmó el contenido de ninguna base de datos | Rutas, catálogo, repositorios, helper de revalidación y 17 pruebas PostgreSQL aprobadas en 3G.5 | Instrumento/licencia y reglas aprobadas; límites clínicos y ciclo de vida de datos |
| Safety | Contratos, puertos y orquestación interna con autorización deny-by-default | **Desactivado**: no montado, sin detector productivo, sin adaptador de autorización habilitante ni dispatcher activo | `src/app.ts`, README, puertos, autorizer por defecto y orquestador | Finalidad separada aprobada, política profesional/legal, responsables y protocolos operables; no es detector de emergencias |
| LongitudinalMonitoring | Enrollment voluntario, sesiones explícitas, propiedad, consentimiento y revalidación transaccional | Rutas disponibles para metadatos de inscripción/sesión; no hay mediciones, observaciones ni tendencias clínicas | Rutas, repositorios, migración 0005 y pruebas existentes | Revisión de consentimiento/retención y, antes de mediciones, diseño y aprobación independiente |

## Rutas montadas y contratos

Rutas observadas en `src/app.ts` y los routers conectados. Las rutas de datos propios usan JWT y derivan `accountId` del middleware; `/health`, registro/inicio de sesión y consulta de avisos son públicos según su propósito. OpenAPI se sirve desde el router compartido. La inspección encontró esquemas Zod estrictos en las operaciones sensibles y operaciones de evaluación/monitoreo documentadas.

| Método/ruta | Módulo | Auth / propietario | Consentimiento y efectos |
|---|---|---|---|
| `GET /health` | Infraestructura | Pública | Sin datos de cuenta |
| `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/sign-out` | Authentication | Flujos de credenciales/sesión | Creación/rotación/revocación de cuenta o sesión; no son autorización de finalidades sensibles |
| `GET /api/v1/users/me`, `PATCH /api/v1/users/me` | Users | JWT y cuenta del token | Perfil propio; no concede consentimiento de tratamiento |
| `POST /api/v1/conversations`, `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages` | Conversations | JWT; consultas acotadas al propietario | Crear/listar/leer historial; no transfieren contenido nuevo a OpenAI |
| `POST /api/v1/conversations/:id/messages` | Conversations | JWT, propietario y estado | `ai_conversation_processing`; revalidación en la escritura y antes de transferir contexto al proveedor; persiste el turno |
| `POST /api/v1/conversations/:id/messages/stream` | Conversations | JWT, propietario y estado | Misma finalidad; comprueba antes de efectos y revalida antes de OpenAI; SSE cancela generación si la conexión se pierde |
| `GET /api/v1/consents/notices` | Consent & Privacy | Pública | Solo avisos publicados disponibles; ver un aviso no crea grant |
| `GET /api/v1/consents/me`, `POST /api/v1/consents/me/decisions` | Consent & Privacy | JWT y cuenta del token | Consulta/registro explícito de decisiones versionadas; no se acepta `accountId` del body |
| `GET /api/v1/preliminary-assessments/info`, `POST /api/v1/preliminary-assessments`, `GET /api/v1/preliminary-assessments`, `GET /api/v1/preliminary-assessments/:id` | PreliminaryAssessment | JWT; consultas propias | Información/inicio/lectura. Inicio exige `preliminary_assessment` e instrumento aprobado disponible |
| `POST /api/v1/preliminary-assessments/:id/responses`, `POST /:id/pause`, `POST /:id/resume`, `POST /:id/withdraw`, `POST /:id/complete`, `GET /:id/result` bajo `/api/v1/preliminary-assessments` | PreliminaryAssessment | JWT y propiedad | Respuestas, transiciones y resultado propio. Respuesta/reanudar/finalizar revalidan consentimiento en la transacción; resultado actual no disponible clínicamente |
| `GET /api/v1/monitoring/info`, `POST /api/v1/monitoring/enrollments`, `GET /api/v1/monitoring/enrollments`, `GET /api/v1/monitoring/enrollments/:id` | LongitudinalMonitoring | JWT y cuenta del token | Inicio/listado/consulta de enrollment; iniciar exige `longitudinal_monitoring` |
| `POST /api/v1/monitoring/enrollments/:id/pause`, `/resume`, `/withdraw`, `/complete`, `/sessions`; `GET /api/v1/monitoring/enrollments/:id/sessions` | LongitudinalMonitoring | JWT y propietario | Reanudar y crear sesión revalidan consentimiento dentro de la escritura; pausa/retiro/finalización permiten detener la participación |

No se encontraron rutas montadas para extracción estructurada ni Safety. Se verificó el montaje y las rutas registradas; no se hizo una prueba HTTP de cada operación en este turno. Los contratos OpenAPI fueron inspeccionados junto con los routers; las pruebas de integración reportadas previamente aportan cobertura HTTP para Consent, PreliminaryAssessment y LongitudinalMonitoring.

## Finalidades y autorizaciones

| Finalidad del esquema Consent | Uso observado | Límite |
|---|---|---|
| `ai_conversation_processing` | Envío conversacional REST/SSE a OpenAI | No sustituye consentimiento de extracción, evaluación o monitoreo |
| `structured_signal_extraction` | Caso de uso interno de ConversationalProcessing, junto con consentimiento conversacional | No se invoca automáticamente desde el chat; no persiste resultados |
| `preliminary_assessment` | Inicio y operaciones de evaluación que escriben/resumen respuestas/resultados | Sin instrumento válido disponible, no se inicia evaluación útil; la autorización no valida clínicamente un instrumento |
| `longitudinal_monitoring` | Enrollment, reanudación y creación de sesión | No autoriza captura de síntomas automática ni otras finalidades |
| `safety_signal_processing` | **No es una finalidad admitida/publicada en Consent** | Propuesta solamente; Safety falla cerrado y no se activa |
| Acciones externas/contacto a terceros | No hay finalidad/flujo activo auditado para ello | Requiere una decisión legal/ética/profesional separada; no automatizar |

Consentimiento es explícito, versionado y append-only. La operación protegida exige grant más reciente vinculado al aviso actual publicado y efectivo; retiro/rechazo, aviso sustituido, ausencia o fallo del checker deniegan. La revalidación de PreliminaryAssessment usa transacción y orden cuenta `FOR SHARE` → aviso vigente `FOR SHARE` → escritura/fila de evaluación. Los cambios de Consent toman la cuenta `FOR UPDATE` antes del aviso. Conversations también coordina escrituras/retiros y revalida antes de transferir texto al proveedor; no mantiene transacción abierta durante OpenAI/SSE. No se afirma que el retiro borre retroactivamente información ya persistida o transferida.

## Pruebas y verificaciones

| Verificación | Resultado de esta revisión |
|---|---|
| `npm run typecheck` | Aprobado (`tsc --noEmit`) |
| `npm run build` | Aprobado (`tsc`) |
| `npm test` | Aprobado: 222 pruebas, 28 archivos |
| `npm run test:integration` | Omitido: `TEST_DATABASE_URL` no configurada; no se usó `DATABASE_URL` ni se hizo conexión |
| Integración previa | 70 aprobadas en 9 archivos según el estado reportado por el proyecto; dentro de esa evidencia, 17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5. No se repitieron en este turno |
| Migraciones | Archivos 0000–0005 presentes. La aplicación hasta 0005 en bases de prueba/desarrollo es un estado reportado previamente; esta revisión no consultó DB ni aplicó migraciones |
| OpenAI real | No invocado |

Los archivos de integración cubren Authentication/Users, Consent, Conversations REST/SSE, ConversationalProcessing interno, PreliminaryAssessment y LongitudinalMonitoring. En particular, se reportan **17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5**, incluidos escenarios de aviso vigente, sustitución previa y carreras con operaciones protegidas. En esta revisión de cierre no se repitió la suite porque `TEST_DATABASE_URL` no estaba configurada.

## Desactivado deliberadamente

- ConversationalProcessing no está conectado al chat, no se ejecuta automáticamente y no persiste observaciones.
- Safety no está registrado en la aplicación, no tiene detector productivo, autorización productiva, política aprobada ni dispatcher operativo.
- LongitudinalMonitoring no crea sesiones por cron, chat o actividad; no persiste mediciones ni tendencias.
- PreliminaryAssessment no incorpora instrumentos clínicos reales, cuestionarios ni puntuaciones. El resultado disponible en código indica no disponibilidad, no diagnóstico.
- No se automatizan contacto con terceros, alertas, derivaciones ni respuestas de emergencia.

## Hallazgos y riesgos residuales

1. **Integración no repetida en esta revisión.** Las 70 integraciones previas, incluidas las 17 de PreliminaryAssessment aprobadas en 3G.5, se reportan como evidencia anterior; en este turno no hubo `TEST_DATABASE_URL` para volver a ejecutarlas.
2. **Gobernanza de avisos.** El código garantiza versionado e integridad, pero no sustituye aprobación jurídica/ética ni proceso organizacional de publicación/revisión.
3. **Datos sensibles y ciclo de vida.** Retención, borrado/supresión, backups, acceso histórico tras retiro, exportación, incidentes y registros de infraestructura requieren decisiones y validación fuera del código.
4. **Proveedor de IA.** `store:false`, contexto limitado y herramientas vacías son controles técnicos del adaptador, no consentimiento ni evaluación integral de transferencia, contrato, región o retención del proveedor. Este turno no llamó a OpenAI.
5. **Aptitud para uso real.** No hay aprobación clínica, ética, legal ni institucional, ni se validó un despliegue operativo. No declarar el backend listo para producción o piloto.

No se identificó durante esta inspección un defecto crítico de código que obligue a declarar fallido el cierre de infraestructura. El hallazgo G34-01 de 3G.4 está corregido en 3G.5 y validado por las 17 pruebas PostgreSQL del módulo. Las integraciones no se repitieron en esta revisión; persisten las limitaciones profesionales, jurídicas, éticas y operativas descritas aquí.

## Requisitos antes de cualquier activación

### Revisión profesional y metodológica

- Aprobar instrumento, licencia, población/idioma, versión, reglas interpretativas y comunicación de resultados de PreliminaryAssessment.
- Aprobar escenarios, límites, incertidumbre, participación humana, contingencia y revisión periódica antes de habilitar Safety; determinar recursos humanos realmente disponibles.
- Revisar lenguaje conversacional, extracción, manejo de datos insuficientes y criterios de parada; no tratar outputs generativos como validación clínica.
- Definir protocolo de estudio, supervisión, sesgo, métricas y mecanismo de suspensión.

### Revisión jurídica, ética e institucional

- Revisar avisos exactos, finalidades, proveedor/destinatarios, transferencias, derechos y consecuencias de retirar consentimiento.
- Obtener autorizaciones institucionales/éticas y determinar la base jurídica aplicable al tratamiento de datos sensibles.
- Aprobar retención, supresión, backups, acceso, respuesta a incidentes y solicitudes de titulares.
- Revisar condiciones, configuración y operación real del proveedor y observabilidad externa.

No se afirma cumplimiento de normativa peruana por el mero funcionamiento de los controles técnicos.

## Condiciones técnicas de cierre y siguiente fase

El **cierre técnico de infraestructura** queda respaldado por las verificaciones unitarias/typecheck/build de este turno y por la evidencia de integración previamente reportada: 70 pruebas en 9 archivos, incluidas 17 pruebas PostgreSQL de PreliminaryAssessment aprobadas en 3G.5. Esta revisión no volvió a conectarse a PostgreSQL, pues `TEST_DATABASE_URL` no estaba configurada.

Antes de una futura activación: mantener consolidada la auditoría 3G.4 con el estado corregido de G34-01; volver a ejecutar las integraciones en una `tesis_test_db` aislada cuando esté disponible; revisar API/OpenAPI al habilitar cada capacidad; aprobar y publicar avisos mediante proceso gobernado; revisar políticas de proveedor y ciclo de vida de datos; completar validación clínica, jurídica, ética e institucional; y planificar activación gradual y reversible con supervisión humana. Este documento no autoriza ninguno de esos pasos.

## Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 2026-11-21 | Cierre técnico documental de Sprint 3; inspección de composición/rutas/módulos y ejecución de typecheck, build y pruebas unitarias. |
