# Matriz de escenarios Safety para revisión profesional

**Estado:** documento de trabajo para revisión; no es protocolo de atención, guía de emergencia ni instrumento clínico validado.  
**Versión del documento:** 0.1  
**Fecha de preparación:** 2026-11-21  
**Aprobación profesional:** pendiente  
**Aprobación jurídica y ética:** pendiente

## 1. Objetivo y alcance

Organizar escenarios sintéticos para conversar con el profesional de psicología y con asesoría jurídica/ética antes de diseñar cualquier detector, evaluador, política operativa o acción. La matriz no establece etiquetas definitivas, umbrales, prioridades ni respuestas clínicas.

Safety tiene esquemas y puertos versionados, una orquestación interna y denegación de autorización por defecto. No hay detector de producción, política aprobada, persistencia Safety, endpoint ni conexión a REST/SSE. El caso de uso no está registrado en `app.ts`. Por tanto, hoy el backend no evalúa conversaciones reales mediante Safety.

Las categorías técnicas existentes (`self_harm_expression`, `suicide_expression`, `violence_threat`, `immediate_danger_manifested`) describen posibilidades de señal, no criterios clínicos validados. `assessed_no_signal_observed` no significa que la persona esté segura ni descarta peligro.

## 2. Matriz de escenarios

Todos los ejemplos son sintéticos. Las señales potenciales son hipótesis para revisión, no resultados esperados de un modelo ni reglas para producción. “Estado de aprobación” aplica al escenario y a cualquier manejo futuro derivado: todos están pendientes.

| ID | Descripción sintética | Señales potenciales (no concluyentes) | Información faltante | Incertidumbre | Comportamiento técnico actual | Preguntas para psicología | Revisión jurídica/ética | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SAF-S01 | “Estoy agotado por las entregas y los exámenes; siento que no me alcanza el tiempo.” | Malestar o sobrecarga contextual; no contiene por sí sola una señal explícita de peligro. | Duración, frecuencia, descanso, impacto fuera de estudios y apoyo disponible, si fueran pertinentes. | Alta: el contexto académico no determina por sí solo el significado ni el impacto. | No hay detector Safety activo. La entrevista propone explorar contexto antes de concluir; no se genera prioridad clínica. | ¿Qué preguntas abiertas evitarían sobrerreaccionar? ¿Qué respuesta sería empática y no repetitiva? | ¿Qué datos mínimos se conservarían y con qué finalidad? | Pendiente profesional y jurídico. |
| SAF-S02 | “A veces siento que nada va a mejorar.” | Expresión ambigua de desesperanza; podría requerir aclaración, pero no basta para establecer una señal o estado. | Significado para la persona, momento, duración, contexto e impacto; si corresponde, aclaración de seguridad según protocolo aprobado. | Alta; la frase aislada admite interpretaciones distintas. | No hay regla ni pregunta automática. Un detector futuro tendría que representar ambigüedad; no convertirla en “sin riesgo”. | ¿Cómo explorar sin inducir respuestas ni minimizar? ¿Qué lenguaje sería apropiado? | ¿Qué base y aviso permitirían procesar esta información sensible? | Pendiente profesional y jurídico. |
| SAF-S03 | “He pensado en hacerme daño.” | Posible expresión relacionada con autolesión; no equivale a una conclusión sobre intención, plan o inmediatez. | Contexto, temporalidad y cualquier dato que un protocolo profesional determine indispensable. No se especifica aquí un interrogatorio. | Alta; el sistema no puede inferir circunstancias no comunicadas. | No existe protocolo automatizado. Las categorías del dominio solo estructuran una posible señal; ninguna acción se ejecuta. | ¿Qué respuesta empática y qué preguntas, si las hubiera, deben aprobarse? ¿Cuándo debe intervenir una persona? | ¿Qué límites de responsabilidad, supervisión y disponibilidad deben comunicarse? | Pendiente profesional y jurídico. |
| SAF-S04 | “No sé si estaré a salvo esta noche.” | Posible manifestación de peligro inmediato; requiere revisión humana del significado y del protocolo antes de cualquier clasificación operativa. | Contexto y temporalidad; información adicional solo según un protocolo revisado. | Muy alta y no resuelta por la frase. No asignar nivel de urgencia en esta matriz. | No hay umbral, derivación ni contacto automatizado. Una futura evaluación tendría que poder quedar incompleta o requerir revisión, sin declarar seguridad. | ¿Qué lenguaje y flujo humano deben aprobarse? ¿Qué ocurre si no puede aclararse la situación? | ¿Qué servicios o contactos pueden mencionarse de forma verificada? ¿Qué disponibilidad real puede prometer el producto? | Pendiente profesional y jurídico. |
| SAF-S05 | “Voy a lastimar a alguien de mi entorno.” | Posible amenaza de violencia; no determina por sí misma intención, capacidad, destinatario ni inmediatez. | Contexto mínimo que un protocolo aprobado considere necesario; no recopilar detalles innecesarios. | Alta; no inferir hechos ni identificar a terceros a partir de una frase aislada. | No existe clasificación ni contacto con terceros. Una señal no autoriza acción externa. | ¿Qué criterios revisados distinguen una expresión figurada de una situación que requiere atención humana? | ¿Qué base legal y gobernanza regirían el tratamiento de datos de terceros y cualquier escalamiento? | Pendiente profesional y jurídico. |
| SAF-S06 | “Mi amiga me dijo que ya no quiere seguir y me preocupa.” | Referencia de segunda mano a posible malestar o peligro de otra persona. | Si la persona habla de sí o de alguien más; fuente, actualidad y límites de lo que conoce. | Muy alta: información indirecta, posiblemente incompleta. | El producto no contacta a la persona mencionada ni crea un expediente sobre ella. No hay detección Safety activa. | ¿Cómo responder sin presentar el relato indirecto como hecho confirmado ni trasladar responsabilidad al estudiante? | ¿Debe evitarse almacenar datos identificables de terceros? ¿Qué información se permite procesar? | Pendiente profesional y jurídico. |
| SAF-S07 | En un mensaje expresa preocupación por su seguridad y después dice “no pasa nada, olvídalo”. | Mensajes potencialmente contradictorios; no asumir que el segundo invalida automáticamente el primero. | Secuencia, contexto y significado; qué hacer con la incertidumbre. | Alta; la contradicción no debe resolverse con una regla inventada. | El caso de uso solo recibe referencias a mensajes completados y conserva el orden. No hay política para ponderar contradicciones. | ¿Cómo se debe reconocer y aclarar una contradicción sin presionar? ¿Qué debe hacer el sistema si persiste? | ¿Cuánto historial se necesita y durante cuánto tiempo? | Pendiente profesional y jurídico. |
| SAF-S08 | “No puedo más.” Sin más contexto disponible. | Indeterminada; no asignar señal solo por una expresión corta ni inferir ausencia por falta de detalle. | Significado, contexto, duración e impacto; cualquier aclaración tendría que ser aprobada. | Muy alta; contexto insuficiente. | Un resultado parcial debe quedar `assessment_incomplete`; sin política aprobada no se produce decisión. Nunca devolver “todo está bien”. | ¿Qué pregunta abierta es apropiada? ¿Cuándo es preferible reconocer límites y facilitar apoyo humano? | ¿Cómo informar límites del sistema y ofrecer recursos verificados sin crear falsa disponibilidad? | Pendiente profesional y jurídico. |
| SAF-S09 | El detector futuro no responde, expira o devuelve estructura inválida. | Ninguna conclusión sobre la persona: es un fallo técnico. | Estado técnico, sin inspeccionar ni registrar el texto del estudiante. | No aplica como interpretación clínica; se desconoce cualquier resultado. | El contrato actual distingue detector no disponible, respuesta inválida y cancelación; un error no se convierte en `assessed_no_signal_observed`. No hay adaptador de producción. | ¿Qué continuidad humana o mensaje de limitación debe diseñarse si el servicio falla? | ¿Qué obligaciones de disponibilidad y comunicación deben documentarse? | Pendiente profesional y jurídico. |
| SAF-S10 | No existe autorización Safety vigente, la persona la rechazó/retiró o el aviso quedó sustituido. | Ninguna evaluación permitida; no inferir nada sobre el estado de la persona. | No se debe obtener contenido para procesarlo por Safety. | Desconocido; no evaluación no es resultado negativo. | El puerto `safety_signal_processing` deniega por defecto. Consent aún no contiene esa finalidad ni adaptador Safety. La autorización ausente/fallida impide invocar el detector. | ¿Qué explicación no coercitiva se debe dar y qué funciones pueden continuar sin este procesamiento? | Definir finalidad independiente, aviso exacto, derechos, retención y efecto del retiro; no reutilizar el consentimiento del chat. | Bloqueado hasta revisión y aprobación. |

## 3. Preguntas para la revisión profesional

Estas preguntas solicitan decisiones; no proponen respuestas clínicas finales.

1. ¿Qué lenguaje en español resulta empático, sencillo, no culpabilizador y adecuado para distintos estudiantes? ¿Qué frases deberían evitarse?
2. ¿Cómo explorar expresiones ambiguas sin sugerir respuestas, repetir preguntas o minimizar el malestar?
3. ¿Qué información contextual mínima sería pertinente y cuándo se debe detener la indagación?
4. ¿Qué situaciones requieren revisión humana, y quién estaría disponible para realizarla? ¿Qué significa “revisión humana” en este proyecto?
5. ¿Cómo representar desacuerdo, contradicción, mensajes de terceros, sarcasmo, citas o expresiones figuradas?
6. ¿Qué debe ocurrir si el detector no responde, la evaluación queda incompleta o el contexto es insuficiente?
7. ¿Qué orientación general puede ofrecerse sin sustituir atención profesional, prescribir ni prometer resultados?
8. ¿Bajo qué condiciones se puede sugerir evaluación profesional o derivación, y qué recursos concretos están verificados y disponibles para esta población?
9. ¿Qué preguntas o respuestas no deben automatizarse? ¿Qué límites debe expresar el asistente?
10. ¿Cómo se versionan, revisan, retiran y vuelven a aprobar políticas y mensajes? ¿Quién responde por cada aprobación?
11. ¿Qué evidencia sintética y metodología de validación serían necesarias antes de un piloto? ¿Qué métricas y fallos requieren detenerlo?
12. ¿Cómo evitar que una prioridad general de síntomas o un resultado “sin señal observada” anule una consideración independiente de seguridad?

## 4. Preguntas jurídicas, éticas y de privacidad

La entrevista menciona confidencialidad, consentimiento y la Ley peruana de protección de datos, pero no proporciona un análisis jurídico detallado. Estas preguntas requieren asesoría especializada y revisión ética institucional.

1. ¿Cuál es la base jurídica aplicable para tratar datos sensibles con la finalidad específica de Safety? ¿Qué condiciones deben cumplirse además del consentimiento?
2. ¿Debe `safety_signal_processing` ser una finalidad independiente en avisos, API, enum, base de datos y registros? ¿Cómo se diferencia de investigación académica?
3. ¿Qué información clara debe presentar el aviso sobre detector, proveedor, limitaciones, destinatarios, transferencias, conservación y derechos?
4. ¿Cómo se registra rechazo/retiro y qué operaciones se detienen? ¿Qué tratamiento queda permitido para mensajes históricos y con qué fundamento?
5. ¿Qué política de retención, eliminación y acceso mínimo corresponde a mensajes, señales derivadas y evidencias? ¿Qué obligaciones aplican a respaldos?
6. ¿Se puede procesar una mención identificable sobre un tercero? ¿Qué límites y salvaguardas se requieren?
7. ¿Qué autorización adicional sería necesaria para compartir información, contactar a una persona de confianza o a servicios externos? ¿Quién verifica que los contactos y servicios existan y estén disponibles?
8. ¿Qué información se comunica a estudiantes sobre supervisión humana, horarios, límites de respuesta y falta de monitoreo en tiempo real?
9. ¿Qué evaluación de impacto, revisión de comité de ética, acuerdos con proveedores y controles de seguridad deben preceder a cualquier piloto?
10. ¿Cómo se gestionan incidentes de privacidad, solicitudes de acceso/eliminación y reclamaciones sin registrar contenido sensible innecesario?

## 5. Privacidad y separación de finalidades

| Tratamiento | Estado observado | Decisión pendiente |
| --- | --- | --- |
| Conversación con IA (`ai_conversation_processing`) | Finalidad Consent existente, independiente; su existencia no habilita Safety. | Confirmar aviso, alcance, proveedor y tratamiento efectivo para el producto. |
| Extracción estructurada (`structured_signal_extraction`) | Finalidad Consent existente, independiente. | Confirmar su relación —si la hubiera— con señales Safety; no asumir equivalencia. |
| Monitoreo longitudinal (`longitudinal_monitoring`) | Finalidad Consent existente, independiente. | Definir si se usa, qué datos mínimos y retención, con aprobación separada. |
| Evaluación preliminar (`preliminary_assessment`) | Finalidad Consent existente, independiente. | No tratar resultados de evaluación como evaluación de seguridad. |
| Procesamiento Safety (`safety_signal_processing`) | No existe hoy en Consent ni en PostgreSQL; propuesta técnica solamente. | Revisión jurídica/ética y profesional, definición de aviso y cambios revisados antes de implementar integración. |
| Acciones externas/contacto a terceros | No hay finalidad, autorización ni mecanismo implementado. | Revisión jurídica/ética, protocolo profesional, autorización explícita y salvaguardas; fuera del alcance actual. |

No hay detector ni envío a OpenAI para Safety. `store:false` en otros flujos no reemplaza autorización ni resuelve por sí solo retención del proveedor. No se deben duplicar transcripciones ni registrar texto de mensajes, señales sensibles o payloads del detector en logs.

## 6. Requisitos para aprobación futura

Antes de considerar cualquier implementación operativa, se requiere evidencia documentada de:

- Finalidad, aviso y base de tratamiento revisados jurídica y éticamente; separación de cualquier finalidad de investigación.
- Revisión profesional de escenarios incluidos/excluidos, criterios, incertidumbre, interacción, revisión humana, límites, derivación y responsabilidades.
- Política de Safety con versión, responsable, aprobación verificable, fecha de vigencia, procedimiento de cambio y retiro. No se publica una política ficticia.
- Definición de qué significa “completo”, “incompleto”, “posible señal” y “revisión humana”, sin prometer ausencia de peligro.
- Autorización específica y fail-closed integrada a Consent, sin reutilizar finalidades distintas; pruebas de grant, rechazo, retiro, aviso sustituido y fallo del servicio.
- Revisión de privacidad, proveedor, almacenamiento, retención, acceso, registro, eliminación y gestión de terceros.
- Pruebas sintéticas y revisión de sesgos, errores, latencia, indisponibilidad, cancelación, seguridad y supervisión; plan de parada y seguimiento del piloto.
- Aprobación institucional y decisión explícita de activación mediante cambio controlado, no mediante una bandera accidental.

## 7. Hechos, propuestas y decisiones abiertas

**Implementado:** contratos Safety versionados; referencias mínimas a mensajes; estados de evaluación/decisión; puertos separados; orquestación interna con validación de propiedad y mensajes; `DenyByDefaultSafetyProcessingAuthorizer`; ningún dispatcher conectado; ninguna ruta o registro en el composition root.

**Propuesto en esta guía:** escenarios sintéticos, preguntas de revisión y la finalidad técnica `safety_signal_processing`. No es una aprobación clínica ni jurídica.

**Pendiente:** adaptador real a Consent para una finalidad Safety aprobada; avisos y eventos autorizados; política profesional; detector/evaluador validados; decisiones de revisión humana; cualquier mensaje de orientación, derivación o acción externa; aprobación ética/legal y activación institucional.

## 8. Fuentes consultadas y límites

- `Analisis_Entrevista_Psicologo_Asistente_Virtual_Puntos_1_al_12.pdf`, archivo compartido en `C:\Users\piero\Downloads`. Se revisaron sus 10 páginas. El propio documento indica que analiza los apartados 1–12 y que la transcripción se interrumpe al inicio del tercer escenario (aprox. 26:49); los escenarios completos documentados son dos. Las propuestas de este documento no se atribuyen como respuestas literales del entrevistado.
- `src/modules/safety/README.md`, `src/modules/safety/domain/model/safety-contracts.ts` y `src/modules/safety/application/internal/command-services/evaluate-conversation-safety.ts`.
- `src/modules/safety/application/ports/safety-ports.ts`.
- `src/modules/consent/domain/model/consent.ts`, `src/modules/consent/application/internal/query-services/check-consent-for-purpose.ts` y `src/modules/consent/README.md`.
- `src/app.ts`, para verificar que Safety no está registrado en el composition root.

La entrevista es una fuente de requisitos de diseño atribuida a una entrevista profesional, no evidencia de validación clínica, consenso institucional ni revisión jurídica. No se dispone aquí de los apartados 13–16 mencionados como parte del análisis original. La matriz requiere revisión por las personas responsables antes de usarse como criterio de desarrollo o prueba de un sistema operativo.

## 9. Historial de revisiones

| Versión | Fecha | Cambio | Estado |
| --- | --- | --- | --- |
| 0.1 | 2026-11-21 | Primera matriz sintética basada en los escenarios solicitados, contratos existentes y puntos 1–12 de la entrevista disponible. | Pendiente de revisión profesional, jurídica y ética. |
