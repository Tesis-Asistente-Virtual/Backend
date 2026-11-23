# Sprint 5D.3C — diseño de fuente y revisión de evidencia longitudinal

**Fecha:** 2026-11-22  
**Estado:** propuesta de arquitectura; no activa procesamiento ni constituye aprobación clínica, ética o legal.

## 1. Objetivo y estado verificado

Este documento propone cómo obtener y revisar una afirmación sobre continuidad o cambio entre dos periodos sin presentar una inferencia como hecho comprobado.

Hechos observados en el repositorio:

- `preliminaryGuidance` contiene observaciones derivadas de hechos que el extractor marca `reported`, sus `sourceMessageIds` seleccionados, brechas y preguntas opcionales. `reported` significa que el extractor encontró un reporte en el contenido proporcionado; no equivale a confirmación humana.
- El comparador puro 1.1 valida forma, referencias, pertenencia de mensajes al snapshot, periodo, orden temporal y concordancia de campo/contexto. No lee mensajes ni verifica semántica.
- La asociación entre sesión y conversación de 5D.2 persiste únicamente metadatos y el adaptador productivo deniega por defecto porque no hay una versión de aviso revisada para ese alcance.
- No existe un flujo que cree evidencia longitudinal, recoja confirmación del estudiante o registre revisión profesional. No se propone modificarlo aquí.

La posesión de referencias válidas prueba procedencia estructural, no que una afirmación represente correctamente lo expresado por una persona.

## 2. Alternativas de fuente

| Opción | Trazabilidad | Privacidad | Viabilidad para tesis | Carga de usuario | Riesgo de error | Dependencia profesional |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Declaración directa del estudiante en la UI** | Alta si la declaración se vincula al periodo, sesión y mensajes que la motivan; la autoría debe quedar diferenciada de la extracción. | La mejor opción si se limita a los mensajes elegidos y el texto se mantiene efímero; aun así procesa datos sensibles. | Alta como prototipo voluntario, una vez autorizados propósito y acceso histórico. | Media: requiere describir el cambio/continuidad y confirmar o corregir un resumen. | No elimina ambigüedad, sesgo de recuerdo ni errores de selección; conserva la voz de la persona. | Revisión profesional del lenguaje y alcance; no requiere validación clínica por caso para afirmar que es una declaración propia. |
| **B. Candidato generado por IA con referencias textuales y revisión posterior** | Media/alta en referencias; la cita puede ser correcta aunque la interpretación que las une sea incorrecta. | Más alta exposición: requiere enviar contenido al proveedor y mantener las autorizaciones vigentes para procesamiento y extracción. | Media; reutiliza extractor existente, pero no hay contrato longitudinal aprobado ni modelo que valide la relación temporal. | Baja antes de revisar, media durante la confirmación/corrección. | Mayor riesgo de atribución, omisión o falsa relación entre periodos. La confirmación no convierte el candidato en verdad clínica. | Alta para definir límites, revisión de ejemplos y lenguaje; revisar casos de error representativos. |
| **C. Revisión profesional antes de mostrar cada afirmación** | Puede aportar contexto y revisión humana, pero no garantiza certeza ni transforma la observación en diagnóstico. | Alto acceso de terceros a información sensible; requiere definir roles, necesidad, registro, confidencialidad y base autorizante. | Baja para un prototipo escalable de tesis; logística y disponibilidad son dependencias fuertes. | Alta latencia; el estudiante podría esperar revisión. | Reduce algunos errores de interpretación, pero conserva límites de fuente y variabilidad entre revisores. | Muy alta; exige protocolo, competencias, alcance y responsabilidades aprobadas. |

Las opciones no son intercambiables. La revisión profesional de un método o de textos no es lo mismo que revisar el caso individual; la confirmación del estudiante acredita aceptación/corrección de una presentación, no valida clínicamente el contenido.

## 3. Recomendación para un prototipo universitario

**Priorizar A y no usar B ni C como fuente primaria de afirmaciones.** Si las revisiones profesional, jurídica y ética permiten avanzar, el estudiante formularía voluntariamente una comparación breve entre dos periodos concretos. El backend podría mostrar, junto a esa declaración, un borrador determinista compuesto solo por referencias y observaciones ya seleccionadas. El estudiante podría confirmarlo, corregirlo o rechazarlo. Sin confirmación, no se produciría una comparación utilizable.

La declaración directa debe ser fuente distinta de cualquier texto `preliminaryGuidance`. El sistema no debe traducir la opción del estudiante en “mejoría”, “deterioro”, severidad o condición clínica. `change` solo expresa que la persona reportó diferencia; `continuity` solo que la persona reportó continuidad. Debe permitirse no responder y la interfaz debe decir que la comparación se limita a los periodos y evidencia seleccionados.

IA con citas podría estudiarse después como ayuda de redacción, nunca como árbitro semántico. Su salida tendría que etiquetarse como candidata generada, quedar deshabilitada por defecto, mostrar evidencia limitada, admitir rechazo/corrección y exigir autorización separada antes de leer historial o transferir contenido. La revisión profesional por caso no se recomienda para el primer prototipo: requeriría diseñar acceso y operación humana explícitos.

## 4. Separación de conceptos y contrato conceptual

No es un DTO HTTP ni un compromiso de persistencia. Es un vocabulario conceptual para una futura operación autorizada:

```json
{
  "contractVersion": "concept-0.1",
  "claim": {
    "source": "student_authored",
    "relation": "change",
    "period": {
      "earlierSessionId": "550e8400-e29b-41d4-a716-446655440001",
      "earlierConversationId": "550e8400-e29b-41d4-a716-446655440003",
      "laterSessionId": "550e8400-e29b-41d4-a716-446655440002",
      "laterConversationId": "550e8400-e29b-41d4-a716-446655440004"
    },
    "evidenceReferences": [
      { "period": "earlier", "observationIndex": 0, "messageIds": ["550e8400-e29b-41d4-a716-446655440005"] },
      { "period": "later", "observationIndex": 1, "messageIds": ["550e8400-e29b-41d4-a716-446655440006"] },
      { "period": "later", "role": "temporal_statement", "messageIds": ["550e8400-e29b-41d4-a716-446655440007"] }
    ]
  },
  "candidate": { "source": "none", "text": null },
  "studentReview": { "status": "not_requested", "reviewedAt": null, "revision": null },
  "professionalReview": { "status": "not_requested", "reviewedAt": null, "protocolVersion": null },
  "comparisonStatus": "not_available",
  "limitations": ["Concepto sintético: no es una conclusión clínica."]
}
```

Semántica propuesta de los componentes:

- **Afirmación:** origen (`student_authored`, `extractor_candidate` o, si se aprobara un proceso distinto, `professional_reviewed`), relación limitada (`change`/`continuity`), versión y dos periodos identificados. El origen nunca se deduce del texto.
- **Evidencia:** referencias de observación y mensajes con rol de periodo (`earlier`/`later`) y rol de vínculo temporal. Deben pertenecer a la conversación y selección autorizadas de ese periodo. No se copian transcripciones.
- **Candidato generado:** opcional y separado; `none` por defecto. Si una etapa futura usa IA, guardar modelo/versión y referencias de soporte no convertiría la salida en evidencia validada.
- **Confirmación del estudiante:** `not_requested`, `confirmed`, `corrected` o `rejected`; incluye fecha y versión cuando corresponda. Confirmar significa aceptar la presentación para ese propósito, no aprobar una interpretación clínica. Una corrección crea una nueva revisión; no sobrescribe silenciosamente el historial.
- **Revisión profesional:** `not_requested`, `pending`, `reviewed` o `rejected`, más responsable autorizado, fecha y versión de protocolo solo si se aprueba acceso profesional por caso. No equivale a diagnóstico ni autorización legal.
- **Estado de comparación:** `not_available`, `insufficient_information` o un estado descriptivo sustentado. `not_available` es obligatorio ante ausencia/retiro de autorización, falta de confirmación requerida o evidencia no validada; no debe confundirse con “sin cambio”.
- **Limitaciones:** explicación versionada aprobada antes de presentar el resultado. El ejemplo no está aprobado para UI.

No incluir `accountId` controlado por cliente, datos de terceros, score, dirección clínica, umbral, diagnóstico ni recomendación de tratamiento. `concept-0.1` no modifica el contrato del comparador 1.1.

## 5. Autorización y avisos

El backend define estas finalidades distintas: `ai_conversation_processing`, `structured_signal_extraction`, `longitudinal_monitoring` y `preliminary_assessment`. Su existencia técnica no demuestra que los avisos vigentes cubran las operaciones siguientes:

| Operación futura | Alcance que debe describir el aviso y revisar el responsable | Estado conocido |
| --- | --- | --- |
| Asociar metadatos de sesión y conversación | Asociación explícita, finalidad, visibilidad y límites del vínculo. | Bloqueada en producción por el port de denegación por defecto hasta revisión de una versión exacta. |
| Leer mensajes históricos de otra sesión | Qué mensajes se consultan, quién los selecciona, para qué, si salen a un proveedor y cuándo se detiene la lectura. | No asumir que el permiso de chat cubre reutilización longitudinal; no existe activación. |
| Comparar periodos | Uso longitudinal de observaciones y referencias, límites, errores, participación voluntaria y modo de presentar/corregir la comparación. | Revisión de alcance pendiente; no asumir autorización retroactiva. |
| Retener candidatos, confirmaciones o resultados | Campos mínimos, responsable de acceso, duración/criterio de retención, exportación, supresión, backups y tratamiento tras retiro. | Sin política aprobada; no persistir en este incremento. |
| Invocar de nuevo IA para analizar/redactar | Transferencia concreta al proveedor y propósitos vigentes requeridos para procesamiento y extracción, además del uso longitudinal autorizado. | No hay nueva llamada ni autorización implícita. |

Antes de cualquier lectura histórica deben comprobarse ownership y acceso de ambos recursos y cada finalidad aplicable. Un consentimiento posterior no debe tratarse como autorización retroactiva para datos de periodos anteriores. Debe definirse con responsables humanos si se necesita una finalidad/aviso separado o una ampliación explícita; este documento no selecciona ni publica uno.

Ante retiro o aviso sustituido: bloquear nuevas lecturas, generación, asociación y comparación conforme a los alcances que se aprueben. El tratamiento de datos ya generados (conservación, corrección, exportación y supresión) necesita decisión separada; retirar consentimiento no implica automáticamente una política particular de borrado ni permite continuar silenciosamente.

## 6. Casos sintéticos para revisión

Son escenarios de diseño, no reglas clínicas ni fixtures de autorización:

| Caso | Fuente/resultado de diseño esperado | Punto de revisión |
| --- | --- | --- |
| Estudiante escribe una diferencia ficticia entre ambos periodos y confirma la presentación | `student_authored`, evidencia de ambos periodos y mensaje temporal; solo relación descriptiva `change` tras validar estructura. | ¿La UI refleja exactamente lo declarado y deja claro el alcance temporal? |
| Estudiante declara continuidad ficticia y confirma | `student_authored`, relación `continuity`; no se deduce de textos similares. | ¿La palabra “continuidad” se comprende sin connotación clínica? |
| Candidato IA interpreta cambio, pero los mensajes sintéticos no contienen comparación temporal | `extractor_candidate`; sin vínculo válido, `insufficient_information`; no mostrar como hecho. | Medir/analizar error sin datos reales; decidir si el uso de IA aporta valor suficiente. |
| Estudiante rechaza un resumen sintético | Estado `rejected`; descartar candidato efímero y no producir comparación confirmada. | Definir control del estudiante y qué metadatos mínimos se conservan, si alguno. |
| Mensajes ambiguos o sin referencia a dos periodos | `insufficient_information`; no completar por inferencia. | Redacción neutral y opción clara de no continuar. |
| No hay información del periodo anterior o posterior | `not_available`/`insufficient_information`; no afirmar ausencia ni estabilidad. | Explicar el límite sin sugerir que la persona no reportó nada fuera de la selección. |
| Retiro antes de la lectura de historial | Denegar antes de leer y no invocar extractor/comparador. | Probar orden temporal de retiro/operación y política de históricos por separado. |
| Referencias pertenecen a sesiones o conversaciones cruzadas | Rechazo estructural; respuesta externa anti-enumeración sin revelar qué recurso existe. | Probar ownership y correspondencia completa en cualquier futuro caso de uso. |

## 7. Decisiones pendientes

**Profesional de psicología:** lenguaje claro y culturalmente adecuado; qué constituye una comparación expresada por el estudiante; si se admite `change` sin dirección; manejo de ambigüedad, corrección y rechazo; qué límites mostrar; si cualquier candidato IA resulta apropiado. No atribuir respuestas a entrevistas o acuerdos no disponibles.

**Jurídica, ética e investigación:** finalidad y avisos exactos; bases y condiciones del tratamiento sensible; participación voluntaria; uso de mensajes históricos; proveedores; necesidad de evaluación/aprobación ética; derechos, acceso y tratamiento de terceros; retención, exportación, correcciones, supresión, backups y retiro. No fijar plazos legales aquí.

**Producto/operación:** si la comparación existe sin persistencia más allá de una respuesta efímera; quién puede verla; controles para no mostrar resultados desactualizados; comunicación cuando no se puede comparar; soporte de retirada y errores. Ninguna necesidad operativa autoriza revisión por terceros automáticamente.

## 8. Hoja de ruta gradual

1. **Revisión humana del diseño:** obtener decisiones registradas de psicología, asesoría jurídica/ética y responsable de investigación sobre fuente, texto, finalidad, uso histórico y datos retenidos.
2. **Contrato técnico aislado:** si hay aprobación para prototipar, diseñar un constructor puro de afirmación `student_authored` que mantenga el comparador 1.1, periodos, referencias y confirmación/corrección. Sin IA, persistencia ni HTTP.
3. **Pruebas con dobles/datos sintéticos:** cubrir confirmación, rechazo, corrección, evidencia cruzada, consentimiento ausente/retirado y versiones de aviso; no sembrar avisos reales ni autorizar participantes.
4. **Autorización e integración de prueba:** solo después de definir avisos/alcance, implementar ports y revalidación para ownership, asociación, lecturas históricas y retiro; mantener el default deny hasta revisión de la versión específica. Probar en una base local aislada.
5. **Evaluación controlada de UX/protocolo:** únicamente después de aprobación ética/legal y revisión profesional. Medir comprensión y errores con el protocolo aprobado antes de decidir cualquier piloto; no activar Safety ni inferir severidad.

El siguiente incremento técnicamente seguro es el paso 2 **solo después** de la decisión del paso 1. Mientras falten esas decisiones, mantener el comparador desconectado y la asociación denegada por defecto.

## 9. Límites

Este documento no crea reglas clínicas, no verifica significado semántico, no cambia consentimiento, no autoriza leer conversaciones históricas, no implementa almacenamiento, no activa asociación o comparación, y no afirma cumplimiento legal ni validación clínica. Los ejemplos son sintéticos.
