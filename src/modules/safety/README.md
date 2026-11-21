# Safety: autorización y estado de activación

Este módulo contiene contratos y una orquestación interna de preparación. No está conectado a Express, REST/SSE, al ensamblaje de `app.ts` ni a un detector de producción. No persiste evaluaciones ni ejecuta acciones. No debe describirse como detector de emergencias validado.

## Finalidades

| Tratamiento | Finalidad actualmente definida en Consent | Estado para Safety |
| --- | --- | --- |
| Procesamiento conversacional con IA | `ai_conversation_processing` | Independiente; no autoriza procesamiento Safety por sí sola. |
| Extracción estructurada de señales de depresión, ansiedad y estrés | `structured_signal_extraction` | Independiente; no autoriza procesamiento Safety por sí sola. |
| Monitoreo longitudinal | `longitudinal_monitoring` | Independiente; no habilita Safety. |
| Evaluación preliminar | `preliminary_assessment` | Independiente; no habilita Safety. |
| Procesamiento de posibles señales de seguridad | Ninguna | `safety_signal_processing` es una propuesta técnica pendiente de revisión; no existe en Consent ni en el esquema PostgreSQL. |
| Acciones externas, avisos o contacto con terceros | Ninguna | Fuera de alcance. Requiere finalidad, autorización y protocolo propios; no se implementa. |

Consent & Privacy define finalidades independientes y `CheckConsentForPurpose` devuelve permiso únicamente para la finalidad solicitada cuando su estado actual es `granted`. Los avisos ausentes no autorizan tratamiento; los avisos reemplazados generan `renewal_required`; `declined` y `withdrawn` tampoco autorizan. El retiro afecta operaciones futuras y no borra datos históricos. No hay avisos sembrados/publicados automáticamente.

## Integración actual

Safety exige un puerto `SafetyProcessingAuthorizer` con la finalidad explícita `safety_signal_processing`. No se implementó un adaptador a `ConsentPurposeChecker`: el tipo y las restricciones actuales de Consent no contienen esta finalidad. Mapear silenciosamente el consentimiento de chat o extracción sería una autorización distinta y no está permitido.

`DenyByDefaultSafetyProcessingAuthorizer` retorna `false` y sirve como implementación segura mientras no exista una finalidad aprobada. La orquestación no está registrada en el composition root. En cualquier invocación, consulta la autorización antes de recuperar contenido, la revalida inmediatamente antes del detector y antes del evaluador, y falla cerrada si el puerto lanza un error. No existe detector de producción; las pruebas usan dobles sintéticos.

## Aprobaciones pendientes

Antes de considerar activar el tratamiento se requiere:

1. Revisión jurídica y ética de la finalidad, el aviso exacto, sus destinatarios, proveedores, retención y derechos aplicables. El nombre `safety_signal_processing` no constituye por sí mismo base legal ni aprobación.
2. Definir en Consent una finalidad independiente mediante un cambio revisado (modelo, validación, persistencia, API y migración incremental); publicar un aviso únicamente mediante un proceso de release aprobado. Esta implementación no hace esos cambios.
3. Revisión profesional de cada futura política de Safety: escenarios cubiertos, criterios, incertidumbre, mensajes de orientación, límites de intervención, derivación, contacto con terceros, responsables, versión y fechas de vigencia.
4. Evaluación técnica y metodológica del detector/evaluador con datos sintéticos, privacidad, errores, sesgos, límites y supervisión humana. Ninguna categoría actual es un criterio clínico validado.
5. Una decisión explícita de activación y una composición controlada del adaptador; jamás habilitarlo por configuración accidental.

## Límites conocidos

- `assessed_no_signal_observed` no certifica seguridad ni descarta riesgo.
- La orquestación no toma decisiones clínicas, no detecta de manera validada autolesión/suicidio/violencia, no responde al estudiante y no inicia escalamiento.
- El consentimiento no cancela retroactivamente información ya procesada por un sistema externo.
- No hay reglas, umbrales, detector real, políticas publicadas, persistencia ni ejecución de acciones.
- Este documento y el código no constituyen una afirmación de cumplimiento legal ni de validación clínica.
