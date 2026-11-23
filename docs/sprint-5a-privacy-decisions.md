# Sprint 5A.1 — Especificación de privacidad para futuras evaluaciones y seguimiento

## Propósito y estado

Este documento prepara decisiones de privacidad para una posible incorporación futura de DASS-21 y seguimiento longitudinal. **No implementa DASS-21, no habilita recolección psicológica nueva y no define plazos legales.**

- **Implementado:** infraestructura de Consent & Privacy versionada; PreliminaryAssessment puede representar evaluaciones/respuestas/resultados y exige su finalidad en operaciones protegidas; LongitudinalMonitoring guarda inscripciones y sesiones explícitas, con consentimiento transaccional para escrituras; las rutas de extracción conversacional actuales son explícitas y sus resultados descriptivos son efímeros.
- **No implementado/activo:** no hay instrumento DASS-21 aprobado cargado; puntuaciones e interpretación permanecen `not_available`; LongitudinalMonitoring no persiste mediciones, observaciones, síntomas ni tendencias; no hay exportación/supresión específica para estas finalidades; Safety sigue inactivo.
- **Propuesto:** recopilar solo los elementos necesarios para una operación voluntaria autorizada, con acceso por propietario, versionado reproducible y separación entre fuente y derivación.
- **Pendiente de aprobación:** instrumento, licencia, propósito, minimización, retención, exportación, supresión, accesos administrativos y manejo histórico requieren revisión profesional, jurídica, ética y de investigación.

## Inventario de datos y finalidad

| Dato o categoría | Estado actual en el esquema | Finalidad propuesta y minimización | Decisión pendiente |
| --- | --- | --- | --- |
| Cuenta (`accountId`) e IDs UUID | Ya vinculan autenticación, evaluaciones y enrolamientos; claves foráneas limitan relación y cascada según módulo. | Identificar propietario y hacer control de acceso; no duplicar datos de perfil. | Si hace falta una seudonimización adicional para análisis de investigación y cómo mantener la llave separada. |
| Consentimiento: propósito, aviso versionado, acción, fecha, idempotency key | Eventos append-only `granted`/`declined`/`withdrawn`; avisos versionados e inmutables tras publicar. | Evidencia mínima de la decisión para cada finalidad independiente. | Acceso de auditoría, conservación y tratamiento ante solicitud de supresión, sujeto a asesoría. |
| Evaluación: tipo/modo, estado, timestamps, referencia de instrumento y aviso | `preliminary_assessments` ya soporta metadatos y consentimiento; propiedad por `accountId`. | Orquestar una evaluación voluntaria; no inferir diagnóstico desde el estado. | Qué tipos se habilitan, plazos, expiración y consecuencias del retiro. |
| Preguntas/versionado/licencia | Tablas preparadas para definiciones de preguntas e instrumentos aprobados/versionados. No implica instrumento aprobado disponible. | Mantener una versión reproducible y autorización/licencia trazable. | Validez profesional, adaptación lingüística/cultural, licencia, población y aprobación ética antes de cargar instrumento. |
| Respuestas | `assessment_answers` puede guardar estado, pregunta/version e `answer` JSONB bajo la evaluación. La capacidad del esquema no autoriza su uso. | Si se aprueba el instrumento, persistir solo la respuesta necesaria y evitar texto libre salvo justificación. | Si se almacenan respuestas crudas; duración; acceso; edición; borrado/exportación y tratamiento de incompletas. |
| Resultado | `assessment_results` permite persistir versiones, puntajes, interpretación, prioridad y estado de seguridad; constraints actuales exigen scores/interpretación/prioridad `not_available` y seguridad `not_assessed`. | En el futuro, almacenar únicamente resultados reproducibles de reglas e instrumento aprobados, con versión de cálculo. | Validación, explicación, uso, presentación y retención; ninguna regla clínica está aprobada aquí. |
| Enrollment longitudinal | `monitoring_enrollments` persiste estado voluntario, tiempos, versión de contrato y referencia del aviso; límite de una inscripción abierta por cuenta. | Registrar la autorización y el ciclo voluntario, no síntomas. | Frecuencia de sesiones, duración del seguimiento y qué ocurre con históricos tras retiro. |
| Sesión longitudinal | `monitoring_sessions` persiste IDs, estado y timestamps; FK compuesta mantiene propietario del enrollment. | Metadatos mínimos de sesiones iniciadas explícitamente. | Necesidad de cada timestamp y ventana de retención. |
| Medición/serie temporal | No existe tabla de mediciones longitudinales en el esquema actual. | Si se aprueba, valor mínimo estructurado, instrumento/versión, unidad, fecha, origen y referencia al consentimiento vigente; no duplicar respuestas/transcripciones. | Instrumento, comparabilidad entre versiones, granularidad temporal, propósito y acceso. |
| Observaciones conversacionales | Extracción existente bajo demanda; resultado no persistente. Mensajes se conservan en Conversations. | Mantener referencias fuente y no duplicar transcripciones si una función futura se autoriza. | Si y para qué sería necesaria persistencia, y cómo retiro afecta transferencias ya realizadas. |
| Auditoría técnica | Consent events y timestamps de dominio existen; no se debe registrar contenido psicológico. | Registrar acción, actor autenticado, propósito, versión y resultado técnico mínimo, con controles de acceso. | Necesidad de auditoría de lecturas, accesos administrativos y conservación; evitar crear logs paralelos con contenido. |

## Acceso y relación de entidades

**Implementado:** recursos propios se derivan del `accountId` autenticado, y repositorios filtran por propietario. Assessment vincula respuestas y resultados al `assessmentId`; la evaluación contiene la cuenta, la versión del instrumento y el aviso de consentimiento. Monitoring vincula sesión a enrollment y cuenta mediante FK compuesta. Consent events vinculan cuenta, finalidad y versión del aviso.

**Propuesto:** el estudiante accede solo a sus propios registros; separar cualquier rol profesional/investigador en un modelo de autorización explícito, con propósito y auditoría. No se presume que administradores, asesores de tesis o investigadores tengan acceso a datos individuales.

**Pendiente:** definir roles, necesidad de acceso individual, separación de entornos de investigación, seudonimización, aprobación de responsables y gestión de exportaciones.

## Retención, retiro e históricos

No se fija aquí un plazo. La política deberá definir periodos por categoría y propósito, eventos que inician el cómputo, respaldos, expiración, bloqueos legales si correspondieran y responsable de revisión.

El retiro de consentimiento bloquea las operaciones futuras protegidas que consultan esa finalidad. No borra por sí mismo evaluaciones, respuestas, sesiones o eventos históricos; el evento de retiro es inmutable. La cascada de ciertas FK ante eliminación de cuenta es una propiedad de esquema, no una política ni un flujo de supresión implementado. No se deben borrar avisos publicados ni eventos de consentimiento mediante el flujo normal.

Decisiones a aprobar antes de persistir DASS/mediciones:

1. Si se detiene solo la recopilación futura o también se restringe el uso de históricos.
2. Si se conserva, anonimiza, exporta o suprime información ya almacenada tras retiro.
3. Cómo tratar resultados derivados, respuestas parciales, respaldos y registros de auditoría.
4. Qué respuesta se da ante solicitudes de acceso/exportación/supresión y quién las autoriza.
5. Qué artefactos mínimos deben conservarse para reproducir una evaluación sin retener más información personal.

No se asume borrado automático, conservación permanente ni una excepción legal.

## DASS-21 y evaluación futura

Antes de codificar o activar un instrumento se requiere: confirmación de identidad/versionado del instrumento; revisión de licencia y permiso de uso; aprobación profesional de idioma/adaptación/población; protocolo de administración; reglas de puntuación versionadas y revisables; pruebas reproducibles; criterios de comunicación no diagnóstica; revisión ética y jurídica del propósito y aviso; y controles para que ninguna prioridad o seguridad se infiera solo de una puntuación.

No se incluyen preguntas, ítems, puntos de corte, fórmulas ni interpretación clínica en este sprint. La mera presencia de tablas no autoriza cargarlos.

## Monitoreo longitudinal futuro

No se habilita frecuencia ni recordatorio automático. Antes se deben aprobar: voluntariedad y opción de pausa/retiro; periodicidad y límites; origen y comparabilidad de mediciones; gestión de cambios de instrumento; significado de datos faltantes; límites de tendencias descriptivas; reglas de acceso; manejo de interrupciones y retención. La ausencia de una sesión no debe presentarse como mejoría. Safety se mantiene separado y fuera de este diseño operativo.

## Revisión necesaria

- **Psicología:** pertinencia del instrumento y lenguaje, límites de interpretación, información mínima, y manejo de respuestas incompletas.
- **Asesoría jurídica/ética:** finalidades, avisos, base habilitante, derechos de titulares, retención, exportación/supresión, terceros/proveedores y protocolo de investigación.
- **Responsable de investigación:** población, reclutamiento, consentimiento de investigación separado del consentimiento operativo, acceso y uso de datos para análisis.

Este documento no certifica cumplimiento normativo, validez clínica ni aptitud para un piloto.
