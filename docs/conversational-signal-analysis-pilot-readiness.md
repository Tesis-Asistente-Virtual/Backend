# Preparación controlada del piloto: señales conversacionales

## Estado actual

El módulo continúa deshabilitado por defecto. No hay activación de cuentas reales configurada ni aviso publicado para `conversational_signal_analysis`. Las pruebas sintéticas no autorizan procesamiento de participantes. El borrador de consentimiento y la hoja de decisiones están en [conversational-signal-analysis-notice-draft.md](consents/conversational-signal-analysis-notice-draft.md).

El caso de uso analiza solo mensajes de usuario seleccionados, comprueba propiedad y los tres consentimientos vigentes (`ai_conversation_processing`, `structured_signal_extraction`, `conversational_signal_analysis`), y vuelve a comprobarlos antes de persistir. Los repositorios exigen avisos publicados y decisiones `granted` para sus versiones vigentes. Las lecturas también comprueban consentimiento y expiración. La allowlist del piloto es adicional y no reemplaza autenticación ni consentimiento.

## Decisiones humanas que bloquean cuentas reales

Antes de publicar el aviso o agregar una cuenta real a la allowlist deben resolverse, documentarse y asignarse responsables para:

- Responsable del tratamiento, finalidad autorizada, acceso del equipo y del proveedor.
- Confirmación institucional del plazo propuesto de 90 días desde `analyzedAt` y el evento inicial del cómputo.
- Qué elimina el retiro y qué tratamiento reciben copias de seguridad y registros técnicos.
- Seguridad, incidentes y manejo de contenido sensible.
- Protocolo revisado de atención/derivación, sin usar los niveles exploratorios como clasificador de urgencia.
- Aprobación o exoneración institucional/ética aplicable.
- Revisión final del aviso, voluntariedad, comprensión y canal de retiro.
- Entidad contractual, ubicación/región de tratamiento de OpenAI, condiciones aplicables, transferencias internacionales y salvaguardas.
- Identidad y función de las dos personas que, si se aprueba, podrían recibir acceso administrativo; contacto para derechos y consultas.

No hay responsables, firmas, aprobaciones, aviso publicado ni confirmación institucional del plazo registrados aquí. La propuesta técnica está fijada en 90 días; la función no se puede configurar con otro plazo. Esto no constituye una decisión legal ni habilita cuentas reales.

## Configuración de activación

La composición normal consume únicamente configuración de servidor. No existe activación por request, header, query o cuerpo. El proceso falla al arrancar si `CONVERSATIONAL_SIGNAL_ANALYSIS_ENABLED=true` se declara con configuración incompleta. Para activar posteriormente una cuenta dentro de un despliegue revisado deben configurarse todos estos valores en el gestor de secretos/configuración del entorno autorizado (no en el frontend):

| Variable | Requisito |
| --- | --- |
| `CONVERSATIONAL_SIGNAL_ANALYSIS_ENABLED` | `true` solo después de completar las decisiones; omitida o `false` mantiene apagada la función |
| `CONVERSATIONAL_SIGNAL_ANALYSIS_DEPLOYMENT` | Debe ser exactamente `authorized_pilot` |
| `CONVERSATIONAL_SIGNAL_ANALYSIS_ALLOWED_ACCOUNT_IDS` | Lista CSV no vacía de UUIDs de cuentas piloto expresamente autorizadas; duplicados o valores inválidos rechazan el arranque |
| `CONVERSATIONAL_SIGNAL_ANALYSIS_RETENTION_DAYS` | Debe ser exactamente `90`; el plazo requiere confirmación institucional antes de habilitar |
| `CONVERSATIONAL_SIGNAL_ANALYSIS_AUTHORIZATION_REFERENCE` | Referencia documental verificable del expediente institucional y de privacidad aprobado; no es por sí sola una aprobación |

Las tres finalidades deben tener avisos publicados y vigentes, y cada cuenta debe registrar su aceptación separada a las versiones actuales. El sistema bloquea POST, latest e history para cuentas fuera de la allowlist. Retirar o sustituir cualquiera de los consentimientos bloquea nuevas solicitudes y lecturas.

### Acceso del equipo y de infraestructura

Los endpoints disponibles son de cuenta propia: `latest` e `history` toman la identidad del JWT, no un ID de propietario enviado por el cliente. No existe endpoint ni rol administrativo que permita a integrantes del equipo leer análisis de participantes. Por tanto, hoy el acceso administrativo de la aplicación es **ninguno**; no se inventaron UUIDs ni se agregó una puerta administrativa. Si dos integrantes requieren acceso, primero se deben designar y documentar sus cuentas y funciones, y después diseñar/revisar por separado una superficie administrativa auditada y de mínimo privilegio. El acceso de administradores de base de datos, backups, plataforma e incidentes no se controla por la allowlist de la aplicación y debe verificarse con el operador de infraestructura.

La aplicación no imprime el payload del análisis en su manejo genérico de errores; los resultados se guardan en PostgreSQL y la purga del módulo elimina solo análisis vencidos. El repositorio no permite verificar las políticas reales de backups, acceso de soporte, copias, registros del proveedor ni la ubicación/región de tratamiento. OpenAI documenta que los datos de API no se utilizan para entrenamiento por defecto salvo opt-in, y que los registros de supervisión contra abuso pueden conservarse hasta 30 días, con excepciones; la institución debe confirmar la configuración contractual y geográfica concreta antes de comunicarla como hecho del piloto ([controles de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data), [residencia](https://developers.openai.com/api/docs/guides/data-residency), [DPA](https://openai.com/policies/data-processing-addendum/)).

### Activación posterior

1. Completar la hoja de decisión, revisar/publicar los tres avisos aplicables y conservar las referencias documentales.
2. Obtener y verificar el UUID de cada cuenta expresamente incorporada al piloto. Añadir solo esos UUIDs al secreto del entorno autorizado.
3. Tras confirmar institucionalmente 90 días, configurar `CONVERSATIONAL_SIGNAL_ANALYSIS_RETENTION_DAYS=90`, despliegue `authorized_pilot`, referencia documental y flag `true` en el entorno de piloto; reiniciar el servicio y verificar su política mediante pruebas de despliegue. No modificar la configuración global ni el servidor normal para cuentas ajenas.
4. Cada titular debe aceptar los tres avisos vigentes de forma independiente. Validar POST, latest e history con una cuenta piloto autorizada y negativas con otra cuenta, consentimientos retirados y flag apagado.

### Desactivación / reversión

1. Cambiar `CONVERSATIONAL_SIGNAL_ANALYSIS_ENABLED=false` y retirar la allowlist de cuentas; reiniciar/reemplazar todas las instancias. La aplicación queda fail-closed para POST y GET.
2. Revocar los consentimientos correspondientes por el mecanismo normal cuando la decisión del titular o el protocolo lo requiera. La app no interpreta la bandera como consentimiento.
3. Mantener el trabajo de purga programado hasta que los análisis almacenados hayan vencido y se hayan eliminado según el plan aprobado. La supresión de una conversación elimina también los análisis que dependan de ella.
4. Verificar los logs operativos sin imprimir contenido, y probar que la función responde no disponible; no reutilizar el módulo DASS-21 ni sus políticas.

## Purga programable

Existe una tarea de una sola ejecución que reutiliza `PurgeExpiredConversationalSignalAnalyses` y elimina únicamente filas vencidas de `conversational_signal_analyses`, en lotes de hasta 100. No borra mensajes, conversaciones ni datos de otros módulos. Para programarla, use un cron/job del sistema que invoque el comando aprobado en el entorno del piloto; la aplicación no inicia un timer por cada réplica.

La retención de cada fila se computa desde `analyzedAt`: `expiresAt = analyzedAt + 90 días`. Las consultas latest/history solo retornan registros con `expiresAt > now`; cuando encuentran registros vencidos los eliminan dentro de la lectura autorizada. Adicionalmente, el job programado debe invocar la purga por lotes. Requiere `CONVERSATIONAL_SIGNAL_ANALYSIS_PURGE_ENABLED=true`, `CONVERSATIONAL_SIGNAL_ANALYSIS_DEPLOYMENT=authorized_pilot`, `CONVERSATIONAL_SIGNAL_ANALYSIS_AUTHORIZATION_REFERENCE`, `DATABASE_URL` y `CONVERSATIONAL_SIGNAL_ANALYSIS_PURGE_DATABASE_NAME` coincidente con la base del URL y de la conexión. Rechaza `tesis_test_db`, `tesis_demo_db` y `tesis_staging_db`. Haga primero un conteo de verificación:

```powershell
npm run signals:purge:expired:authorized -- --run-expired-signal-purge --confirm-authorized-pilot-database --dry-run
```

El comando de ejecución para el job programado es:

```powershell
npm run signals:purge:expired:authorized -- --run-expired-signal-purge --confirm-authorized-pilot-database
```

La tarea no fue ejecutada durante este cambio. En desarrollo, la tarea previa `signals:purge:expired:test` sigue limitada explícitamente a loopback `tesis_test_db`.

El comando autorizado emite una línea JSON por ejecución con `runId`, base, corte temporal, cantidad elegible/eliminada y duración; los fallos registran solo una categoría segura. La ejecución periódica requiere configurar externamente un cron o tarea del sistema para invocar el comando una vez por ciclo, con acceso al gestor de secretos y conservación/alerta de stdout y stderr. Deshabilitar `CONVERSATIONAL_SIGNAL_ANALYSIS_PURGE_ENABLED` o quitar la tarea detiene ejecuciones posteriores; no revierte eliminaciones ya realizadas. No se creó ni instaló una tarea de sistema en este repositorio.

## Supresión solicitada por el titular

`DELETE /api/v1/conversations/{id}` exige JWT y elimina solo una conversación propia. La operación se serializa con turnos de chat; PostgreSQL elimina en cascada sus mensajes, análisis conversacionales y asociación longitudinal. La misma transacción registra únicamente cuenta, fecha y cantidad eliminada, sin texto ni ID de conversación. No requiere consentimiento vigente, de modo que sigue disponible tras un retiro. Los eventos de consentimiento se conservan; la operación no borra la cuenta, evaluaciones DASS-21, avisos ni otras conversaciones. La migración `0013_conversation_suppression_audit` debe aplicarse al entorno antes de habilitar esta ruta.

El equipo aún debe fijar una política de conservación para conversaciones y mensajes. No se fija aquí un plazo; los 90 días aplican solo a análisis. La política también debe definir solicitudes para eliminar todas las conversaciones de una cuenta, respaldos, retención de evidencias de consentimiento y el efecto de una eventual eliminación de cuenta. Actualmente la clave foránea de `account_consent_events` elimina esos eventos al borrar físicamente la cuenta; la retención legal/institucional de esa evidencia requiere una decisión antes de habilitar supresión integral de cuentas.

## Estado de verificación

El módulo no clasifica ni detecta crisis y no contiene protocolo de atención inmediata. `high` no puede usarse como señal de riesgo clínico ni como disparador de derivación. La institución debe aprobar un procedimiento humano independiente antes de incorporar participantes.

Las pruebas PostgreSQL existentes cubren persistencia/lecturas entre dos cuentas sintéticas, rechazo de consentimiento ausente o retirado, composición deshabilitada, aislamiento y expiración/purga. Las pruebas unitarias cubren configuración de retención exacta de 90 días y allowlist. La ejecución de integración contra PostgreSQL local debe confirmarse separadamente; no se usa una base como sustituto de otra.
