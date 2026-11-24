# Borrador de aviso: análisis exploratorio de señales conversacionales

**Estado:** borrador técnico; no publicado, no revisado por asesoría jurídica/ética y no habilitante. La retención de 90 días es una propuesta del equipo, pendiente de confirmación institucional.  
**Versión propuesta:** `conversational-signal-analysis-1.0-draft`  
**Finalidad:** preparar revisión del aviso correspondiente al propósito `conversational_signal_analysis`.

> Los campos entre corchetes requieren decisión y aprobación antes de publicar. Este borrador no constituye consentimiento válido.

## Qué procesamiento se propone

Si usted lo solicita y otorga este consentimiento por separado, el sistema enviará a OpenAI, proveedor del servicio de inteligencia artificial generativa, los mensajes escritos por usted que seleccione dentro de una conversación. El sistema buscará indicios conversacionales relacionados con ánimo bajo o menor interés, preocupación y sobrecarga o tensión académica. No se analizarán automáticamente todos los mensajes al enviarlos; el análisis se solicita de forma explícita.

El resultado usa niveles `low`, `moderate`, `high` o `insufficient_evidence`. Estos niveles describen únicamente la cantidad y especificidad de evidencia textual en los mensajes seleccionados. No indican gravedad clínica, riesgo, probabilidad de un trastorno ni necesidad de tratamiento. El análisis no es un diagnóstico, no es una escala clínica validada y no calcula puntuaciones DASS-21. La ausencia de una mención no significa que no exista una dificultad.

El análisis puede guardar un resumen, indicadores descriptivos, paráfrasis de evidencia y referencias a los mensajes seleccionados, junto con la fecha, el período observado y las versiones técnicas. El resultado se consulta autenticándose en la cuenta propia. El resultado no debe interpretarse como una evaluación completa de la persona.

## Proveedor y posible tratamiento internacional

OpenAI procesa el texto enviado para prestar el servicio. La solicitud de la aplicación indica que el contenido no se almacene como respuesta (`store:false`); esto no demuestra por sí solo que no existan otros registros operativos del proveedor. La documentación vigente de OpenAI indica que, por defecto, el contenido de API no se utiliza para entrenar o mejorar modelos salvo que el cliente opte expresamente por compartirlo, y que pueden generarse registros de supervisión contra abuso con retención de hasta 30 días, sujetos a excepciones. La cuenta, configuración, entidad contratante, región real de procesamiento y condiciones contractuales de este proyecto deben confirmarse antes de publicar el aviso. Si el procesamiento ocurre fuera del Perú, la institución debe determinar y comunicar la transferencia internacional y las salvaguardas aplicables.

Referencias del proveedor para revisión (no sustituyen la revisión institucional): [controles de datos de la API](https://developers.openai.com/api/docs/guides/your-data), [residencia de datos](https://developers.openai.com/api/docs/guides/data-residency) y [anexo de tratamiento de datos](https://openai.com/policies/data-processing-addendum/).

## Finalidad y acceso

La finalidad propuesta es ofrecerle a usted una síntesis exploratoria y limitada de lo expresado en los mensajes que eligió, para apoyar una reflexión voluntaria. El análisis requiere tres decisiones separadas y vigentes: `ai_conversation_processing` para procesar la conversación con IA, `structured_signal_extraction` para extraer señales estructuradas y `conversational_signal_analysis` para este análisis exploratorio. Aceptar uno no implica aceptar los otros. No se usará como base única para diagnóstico, tratamiento, urgencia, derivación ni decisiones académicas.

La API exige autenticación, verifica que la conversación pertenezca a la cuenta y limita las consultas al análisis de esa misma cuenta. Actualmente no hay una ruta administrativa para que el equipo lea análisis de otras cuentas. La propuesta del proyecto es limitar cualquier acceso administrativo futuro a dos integrantes designados expresamente, pero sus identidades, funciones y controles todavía deben aprobarse; la base de datos y la infraestructura también requieren una política de acceso operativo. No habrá uso secundario sin información y autorización aplicables.

## Conservación y eliminación

La propuesta técnica es conservar el registro del análisis por **90 días desde la fecha de cada análisis**. Al vencer, la aplicación deja de devolverlo y un comando por lotes puede eliminar únicamente esos análisis. La purga periódica depende de una tarea externa que todavía debe configurarse, monitorearse y probarse en el entorno autorizado; no podemos prometer eliminación física puntual hasta verificarla. El borrado de una conversación propia mediante `DELETE /api/v1/conversations/{id}` elimina esa conversación, sus mensajes y análisis derivados, y conserva los eventos de consentimiento. La conversación y sus mensajes no tienen actualmente un plazo automático de vencimiento: el equipo y la institución deben fijar ese plazo antes del piloto.

- Frecuencia, monitoreo, responsable operativo y evidencia de ejecución de la purga: **[pendiente]**.
- Propagación de eliminación a copias de seguridad y registros técnicos del proyecto/proveedor: **[pendiente]**.

Retirar cualquiera de los consentimientos bloquea nuevas solicitudes y la consulta de análisis anteriores en la aplicación. La retirada por sí sola no elimina conversaciones, mensajes ni análisis ya almacenados. Puede solicitar la supresión de una conversación propia mediante el mecanismo disponible en la aplicación; la supresión no borra los eventos que acreditan sus decisiones de consentimiento. La eliminación de análisis vencidos depende de la purga externa indicada arriba. Plazos de respaldos, registros técnicos y atención de otras solicitudes de derechos aún deben confirmarse. Para consultas o solicitudes, contacte a **[responsable/contacto institucional por designar]**.

## Consentimiento y retiro

Este propósito requiere una decisión explícita y separada de los consentimientos de procesamiento conversacional y extracción estructurada. No se presumirá aceptación ni se trasladará una decisión anterior. Usted podrá retirar su decisión mediante el mecanismo de consentimientos vigente, incluido `POST /api/v1/consents/me/decisions` con la acción de retiro correspondiente. La versión aplicable deberá volver a aceptarse si el aviso cambia. El responsable institucional y el canal de consultas o ejercicio de derechos siguen pendientes: **[contacto]**.

## Limitaciones y revisión pendiente

El resultado puede omitir matices, atribuir una paráfrasis incorrecta o no reflejar experiencias no incluidas en la selección. La ausencia de una mención no demuestra ausencia de dificultades. El nivel `high` no representa severidad clínica ni riesgo inmediato. Este módulo no sustituye un protocolo de seguridad revisado.

Antes de publicar el aviso se requiere revisión profesional del lenguaje, revisión institucional/ética y de privacidad, confirmación del proveedor y sus condiciones de tratamiento, decisión sobre acceso y retención, y aprobación del protocolo de respuesta ante contenido sensible.

El asistente puede ofrecer orientación de mejor esfuerzo ante una expresión explícita de peligro inmediato, pero el sistema no supervisa mensajes en tiempo real, no detecta crisis de forma fiable, no activa alertas ni garantiza respuesta humana. En Perú, la Línea 113, opción 5, ofrece orientación de salud mental; para una emergencia médica, el MINSA indica SAMU 106. No espere respuesta del equipo ni del asistente ante peligro inmediato. Las señales `low`, `moderate` y `high` no son niveles de riesgo ni activan derivación. Antes del piloto, la institución debe aprobar y comunicar un protocolo independiente, con responsables, horarios y canales humanos. Fuentes informativas: [MINSA: Línea 113](https://www.gob.pe/institucion/minsa/pages/555-linea-113-salud-recibir-orientacion-e-informacion-en-salud) y [MINSA: SAMU 106](https://www.gob.pe/1013-solicitar-atencion-medida-en-caso-de-emergencia.samu).

## Hoja de decisión para revisión humana

Completar y adjuntar las referencias documentales antes de publicar una versión del aviso. Los responsables se mantienen sin asignar hasta que la institución los designe.

| Decisión | Información que debe quedar resuelta | Revisor responsable | Estado |
| --- | --- | --- | --- |
| Responsable del tratamiento | Se propone UPC; falta confirmar formalmente su rol, contacto de privacidad y encargado del proveedor | Institución / privacidad | Pendiente |
| Finalidad y acceso | Finalidad autorizada, quién accede, designación nominal de hasta dos integrantes, registro de accesos y usos prohibidos | Asesoría / privacidad | Pendiente |
| Conservación | Propuesta de 90 días desde `analyzedAt`; validar plazo, copias de seguridad y frecuencia de purga | Privacidad / responsable de datos | Pendiente de confirmación |
| Retiro y eliminación | Efecto del retiro sobre futuros análisis, lecturas, datos existentes y solicitudes de eliminación | Privacidad / asesoría | Pendiente |
| Seguridad | Controles de acceso, incidentes, comunicación y límites del proveedor externo | Seguridad / institución | Pendiente |
| Señales sensibles | Protocolo revisado para posible peligro inmediato; responsables, tiempos y límites del sistema | Profesional responsable / institución | Pendiente |
| Revisión institucional | Aprobación o exoneración aplicable, con número o referencia verificable | Comité / institución | Pendiente |
| Comprensión y voluntariedad | Lenguaje final, consentimiento separado y mecanismo accesible de retiro | Profesional / participantes de revisión autorizados | Pendiente |

No publicar el aviso ni habilitar cuentas piloto reales hasta que todas las decisiones aplicables tengan una referencia verificable. La conformidad verbal o el resultado de pruebas sintéticas no completan esta hoja.
