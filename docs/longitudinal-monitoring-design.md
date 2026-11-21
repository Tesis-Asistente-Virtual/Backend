# Diseño inicial de LongitudinalMonitoring

**Estado:** propuesta de dominio; no es una función activa ni un protocolo clínico.  
**Versión:** 0.1  
**Revisión profesional, jurídica y ética:** pendiente.

## 1. Objetivo y límites

Diseñar un contexto independiente para un seguimiento voluntario, revocable y temporal de referencias a información relacionada con síntomas. No realiza diagnóstico, no calcula severidad, no predice deterioro, no genera alertas clínicas y no se conecta con Safety.

El contexto separa:

- **Observación conversacional:** salida tentativa de `ConversationalProcessing`; no es una medición ni una evaluación.
- **Evaluación preliminar:** agregado con respuestas y versión de instrumento en `PreliminaryAssessment`; la evaluación estructurada tiene respuestas persistidas.
- **Inscripción y sesión de seguimiento:** participación explícita en una finalidad longitudinal; no existe hoy en runtime.
- **Medición:** referencia versionada a una fuente en una ventana temporal; no equivale automáticamente a puntuación.
- **Tendencia descriptiva:** comparación futura bajo datos compatibles y reglas aprobadas. El contrato actual solo permite `not_available`.
- **Seguridad:** responsabilidad separada de Safety; una tendencia no detecta ni resuelve peligro.

No se asume que un chat sin mensajes implique mejoría, ni que una ausencia de mención implique ausencia de síntomas.

## 2. Auditoría del código existente

| Fuente o capacidad | Hecho observado en el código | Uso posible, sujeto a revisión |
| --- | --- | --- |
| Extracción conversacional | `ConversationSignalExtraction` contiene observaciones tentativas, dimensiones posibles, evidencia faltante y referencias a `sourceMessageIds`. `ExtractAuthorizedConversationSignals` valida propiedad, mensajes completados y los consentimientos `structured_signal_extraction` y `ai_conversation_processing`, y devuelve el resultado al invocador. No hay repositorio ni tabla que persista estas observaciones; el DTO no asigna un ID estable a cada observación. | Solo sería referenciable cuando exista una identidad estable y persistencia/retención aprobadas. No copiar ni presentar el DTO actual como medición longitudinal. |
| Conversaciones | `conversation_messages` almacena mensajes; eso no convierte automáticamente cada mensaje en medición. | Una futura referencia podría señalar mensajes específicos, nunca duplicar el transcript en Monitoring. |
| Evaluaciones | `PreliminaryAssessment` almacena `assessment_answers` con `assessmentId`, `instrumentVersionId`, `questionId`, estado, respuesta y timestamps. La propiedad se deriva de la evaluación. Las versiones de instrumento llevan metadatos de aprobación/licencia. | Referenciar evaluación, resultado y versión exactos; solo tratar como comparable un instrumento aprobado/autorizado y compatible, con autorización vigente. |
| Resultado de evaluación | El modelo y las restricciones actuales solo permiten que score, interpretación, prioridad y estado Safety estén `not_available` (Safety `not_assessed`). | No hay puntajes o interpretaciones clínicos existentes que se puedan convertir en tendencias. |
| Reporte directo de estudiante | No se encontró un agregado independiente de check-in longitudinal en los módulos revisados. | El contrato incluye `student_report` como fuente futura, no como capacidad activa. |
| Consent & Privacy | Existe la finalidad independiente `longitudinal_monitoring`; el checker consulta el estado actual y falla sin `granted`. El adaptador inspeccionado pertenece a PreliminaryAssessment y verifica `preliminary_assessment`; no existe adaptador o caso de uso longitudinal. No hay avisos sembrados automáticamente. | Crear, pausar, reanudar o registrar mediciones requerirá una integración propia que consulte la finalidad exacta y la versión vigente. El consentimiento de chat o evaluación no la reemplaza. |
| Safety | Tiene contratos y orquestación interna, pero permanece desactivado, sin detector productivo ni integración al chat. | Monitoring no replica ni invoca Safety; cualquier alerta queda fuera del contexto y de este incremento. |

## 3. Contratos de dominio implementados

Los contratos están en `src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.ts`, son estrictos con Zod y usan `contractVersion: "1.0"`.

- **MonitoringEnrollment:** `accountId`, `enrollmentId`, estado y trazabilidad del propósito y aviso aceptado. `createMonitoringEnrollment` exige `explicitOptIn: true`, autorización vigente `granted` para `longitudinal_monitoring` y coincidencia exacta del `consentNoticeVersionId`. El contrato no sustituye una consulta en tiempo real a Consent.
- **MonitoringSession:** evento acotado de check-in con propiedad por cuenta, inscripción y estado `in_progress`, `completed` o `abandoned`.
- **MonitoringObservationReference:** unión discriminada para `student_report`, `validated_instrument`, `tentative_conversational_observation` y `monitoring_check_in`. Exige IDs/versiones de origen y fechas; no transporta contenido de conversación ni respuestas.
- **MonitoringMeasurement:** vincula dimensión (`depression`, `anxiety`, `stress`), estado de evidencia (`reported`, `ambiguous`, `not_reported`, `not_assessed`), sesión, cuenta, inscripción y referencia de origen. No contiene puntuación, diagnóstico ni texto libre.
- **MonitoringTrendSummary:** por ahora solo admite `status: "not_available"`, una razón explícita, periodo, referencias de mediciones y `approvedRulesVersion: null`. El esquema rechaza cualquier resultado disponible, dirección o score.

La procedencia no se puede intercambiar: un reporte directo, una respuesta a un instrumento autorizado y una observación tentativa de lenguaje tienen significados y limitaciones diferentes. `not_assessed` describe falta de evaluación, no ausencia.

## 4. Estados e invariantes

Estados de inscripción: `active`, `paused`, `withdrawn`, `completed`.

- Crear inscripción requiere opt-in deliberado, finalidad exacta y aviso vigente.
- `active` puede pausarse, retirarse o completarse.
- `paused` puede reanudarse solo con autorización vigente, retirarse o completarse.
- `withdrawn` y `completed` son terminales.
- No se pueden crear sesiones ni mediciones si la inscripción no está activa.
- Una medición debe pertenecer a la misma cuenta, inscripción y sesión abierta; su fecha observada debe estar dentro del periodo de inscripción y no ser posterior a su registro.
- La fábrica valida referencias y orden temporal. La verificación real de propiedad de fuente y consentimiento vigente corresponde a futuros casos de uso/repositorios, no queda probada por validar un DTO.
- La retirada detiene futuras mediciones; no borra automáticamente fuentes existentes. Retención/eliminación requieren política aprobada.

Las transiciones están modeladas como funciones puras. La revisión del consentimiento durante la operación y las carreras concurrentes todavía requieren un servicio de aplicación y diseño transaccional cuando haya persistencia.

## 5. Consentimiento y flujo futuro

La finalidad `longitudinal_monitoring` ya existe en Consent, pero no hay integración de Monitoring. El flujo futuro propuesto es:

1. Obtener `accountId` desde contexto autenticado confiable y mostrar información clara sobre finalidad, datos, límites y retiro.
2. Ante una acción explícita de inscripción, verificar el estado `granted` y aviso vigente de `longitudinal_monitoring`; no crear enrollment ante ausencia, rechazo, retiro, sustitución o error del checker.
3. Antes de abrir cada sesión y antes de registrar cada medición, volver a verificar la finalidad. No inferir permiso del JWT, del uso del chat ni de `preliminary_assessment`.
4. Persistir únicamente IDs de origen, versiones, estado de evidencia y timestamps necesarios. No duplicar mensajes, respuestas o transcripts.
5. Si la persona pausa, no crear medidas hasta reanudar con autorización vigente. Si retira, bloquear nuevas medidas y conservar el historial según una política jurídica/ética aprobada.

No se implementó este flujo de aplicación ni se activó el consentimiento en runtime.

## 6. Tiempo, comparabilidad y tendencias

Los timestamps son explícitos: `observedAt`, `recordedAt`, `enrolledAt`, apertura/cierre de sesión y periodo del resumen. El orden requerido es `observedAt <= recordedAt`, las referencias deben coincidir con la fecha medida, y el periodo de resumen debe preceder a `calculatedAt`.

No se calcula una tendencia. Para habilitar en el futuro una comparación se necesita definir y aprobar, como mínimo: compatibilidad de instrumento/versiones, escala y dirección, intervalos de observación, datos faltantes, cambios de fuente/contexto, método de comparación, lenguaje permitido y revisión profesional. No se pueden mezclar resultados de conversación, autoinforme e instrumentos como si fueran equivalentes. Sin esos criterios, el resultado permanece no disponible; no se emiten direcciones “mejora/empeora”, predicciones o niveles bajo/moderado/alto.

La entrevista analizada plantea seguimiento voluntario y revocable, registro de fecha/estado informado/frecuencia/intensidad/contexto/impacto, y sujeción a consentimiento y privacidad. También menciona intervalos orientativos de dos a cuatro semanas en ciertos casos, pero no constituye una política aprobada ni se codifica aquí como programación o regla. La entrevista diferencia las situaciones de peligro de un calendario de seguimiento; el diseño actual no crea alertas ni respuesta de seguridad.

## 7. Minimización y seguridad de datos

- Las referencias no contienen transcript ni respuesta textual.
- Una fuente conversacional requiere un `observationId` estable que hoy no existe; no debe generarse mediante índice del arreglo ni reconstruirse desde contenido cambiante.
- Las respuestas de evaluación pueden ser texto libre y sensibles; Monitoring debería referenciar únicamente resultado/versiones aprobadas cuando sea suficiente.
- No se diseñaron logs con datos psicológicos, exportación, retención permanente ni acceso administrativo.
- Toda lectura futura debe delimitarse por `accountId` y verificar que la referencia origen pertenezca a la misma cuenta.
- No hay llamadas a OpenAI, acceso a base de datos ni procesamiento real en este incremento.

## 8. Decisiones pendientes

1. Revisión profesional de qué dimensiones y datos son pertinentes, cómo se formulan check-ins y qué significa una medición comparable.
2. Determinar si el cuestionario, evaluación contextual o ambas pueden originar medidas; no reutilizar respuestas sin revisar compatibilidad, licencia y consentimiento.
3. Definir cadencia voluntaria sin asumir el intervalo de la entrevista como regla; evitar fatiga y permitir pausas/retiro.
4. Aprobar una metodología y vocabulario para tendencias descriptivas antes de permitir cualquier resumen disponible.
5. Revisión jurídica/ética del aviso específico, tratamiento de datos sensibles, base aplicable, derechos, destinatarios, proveedor, retención, eliminación y separación de consentimiento de investigación.
6. Definir controles concurrentes para retiro frente a escritura, y acceso/retención de fuentes referenciadas.
7. Diseñar pruebas de integración aisladas cuando exista persistencia, incluyendo propiedad, consentimiento retirado, compatibilidad de versiones y no escritura tras retiro.

La entrevista es insumo de requisitos, no validación clínica ni asesoría jurídica. El documento consultado cubre los apartados 1–12 y señala que la transcripción se interrumpe al inicio del tercer escenario; no se atribuyen aquí conclusiones sobre contenido que no está incluido.

## 9. Historial de cambios

| Versión | Cambio | Estado |
| --- | --- | --- |
| 0.1 | Auditoría del código y contratos iniciales puros para seguimiento voluntario. | Pendiente de revisión profesional, jurídica y ética. |
| 0.2 | Persistencia de inscripción y sesiones, con propiedad compuesta y revisiones optimistas. | Migración generada; pendiente de aplicación controlada y de revisión profesional/jurídica. |

## 10. Persistencia controlada (Sprint 3F.2)

Se añadieron `monitoring_enrollments` y `monitoring_sessions`. No se crearon tablas de mediciones, tendencias ni observaciones conversacionales. Las lecturas de repositorio requieren `accountId`; la FK compuesta de sesión obliga a que `enrollment_id` y `account_id` correspondan al mismo enrollment. Una cuenta puede tener como máximo una inscripción `active` o `paused` simultáneamente, y un enrollment como máximo una sesión `in_progress`.

Los cambios de estado usan `revision` como control optimista (compare-and-swap); triggers de PostgreSQL refuerzan las transiciones terminales y la inmutabilidad de las referencias de consentimiento. El identificador de aviso se conserva como referencia opaca, sin FK entre bounded contexts: Consent & Privacy sigue siendo la autoridad sobre existencia, vigencia y estado actual del aviso. Los repositorios no consultan ni otorgan consentimiento. Cualquier futuro caso de uso debe comprobar en tiempo real la finalidad exacta `longitudinal_monitoring` antes de crear, reanudar o abrir una sesión.

La migración `drizzle/0005_modern_sir_ram.sql` solo fue generada y revisada en esta etapa; no se aplicó a ninguna base. Para probarla, configurar `TEST_DATABASE_URL` apuntando al PostgreSQL local `tesis_test_db`, verificar que host y base sean los autorizados y ejecutar manualmente `npm run db:migrate:test`. Después, ejecutar `npm run test:integration`. El helper rechaza producción, no usa `DATABASE_URL` como fallback y verifica el nombre de la base y la IP real del servidor. No usar `db:push`. La base `tesis_db` queda fuera de este procedimiento.

La política de una sola inscripción abierta por cuenta reduce duplicados concurrentes, pero debe confirmarse como decisión de producto antes de una activación amplia. Retención, borrado, aviso legal, experiencia de pausa/retiro y revisión ética siguen pendientes. Hasta Sprint 3F.2 no había composición HTTP; el estado posterior se registra abajo.

## 11. Casos de uso y API (Sprint 3F.3)

Se añadieron casos de uso y rutas protegidas bajo `/api/v1/monitoring`: información, inicio/listado/consulta de inscripciones, pausa, reanudación, retiro, finalización y apertura/listado de sesiones. La identidad siempre proviene del JWT. No se aceptan IDs de cuenta en las solicitudes. Las listas usan paginación SQL con límites.

El inicio exige `explicitOptIn: true` y autorización actual de `longitudinal_monitoring`. Reanudar y abrir sesión vuelven a consultar esa finalidad y exigen que el aviso vigente coincida con el referenciado por la inscripción. Si cambió, la operación se deniega y se requiere retirar e iniciar una nueva inscripción con la versión aceptada actual. No se crean avisos. Consent & Privacy mantiene la autoridad sobre el estado; el adaptador de Monitoring solo consulta su contrato.

Pausa, retiro y finalización repetidos son idempotentes cuando ya se alcanzó el estado solicitado. Los cambios usan CAS por `revision`; los conflictos devuelven 409. Una sesión solo puede abrirse con inscripción activa, y la unicidad PostgreSQL impide dos sesiones abiertas simultáneas para una inscripción. No hay mediciones, extracción, tendencias disponibles, automatización, cron ni integración con Safety. El aviso, retención, borrado y revisión ética/jurídica aún requieren aprobación. La comprobación de consentimiento ocurre inmediatamente antes de persistir, aunque la autorización y la escritura no comparten una transacción distribuida con Consent; queda una ventana pequeña de concurrencia para una revisión posterior.
