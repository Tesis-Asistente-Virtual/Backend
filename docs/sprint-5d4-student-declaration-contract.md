# Sprint 5D.4 — contrato puro de declaración voluntaria

**Fecha:** 2026-11-22  
**Estado original:** esquema de dominio puro y pruebas sintéticas; no está integrado con estudiantes, UI, endpoints ni persistencia. No es una aprobación clínica, ética o jurídica.

## Contrato implementado

`src/modules/longitudinal-monitoring/domain/model/student-longitudinal-declaration.ts` define `studentLongitudinalDeclarationSchema`, su tipo TypeScript y `parseStudentLongitudinalDeclaration`. El contrato original estricto usó `contractVersion: "1.0"`; tras Sprint 5D.5 la versión interna vigente es `1.1` y requiere:

- `sessionId`, `conversationId` como UUID y `referencedObservation` como value object efímero versionado (resultado + conversación + posición de guidance + índice fuente + campo/contexto + mensajes).
- `source: "student_self_report"`.
- `confirmationStatus: "student_confirmed"`, que representa una declaración enviada explícitamente; no una validación clínica.
- `createdAt` como fecha/hora ISO con zona horaria.
- `responseType`: `continues`, `changed`, `unsure` o `prefer_not_to_answer`.
- `optionalDescription` de hasta 500 caracteres, opcional solo para `continues` y `changed`; se rechaza texto vacío o un campo de descripción en `unsure`/`prefer_not_to_answer`.

El contrato no admite `accountId`, puntuaciones, severidad ni diagnóstico. Los campos desconocidos se rechazan. No calcula un `comparisonStatus`, no convierte una declaración en evidencia de cambio/continuidad y no integra el comparador longitudinal 1.1.

Ejemplo sintético histórico de la forma 1.0 (no es la forma vigente ni texto aprobado para estudiantes):

```json
{
  "contractVersion": "1.0",
  "sessionId": "550e8400-e29b-41d4-a716-446655440001",
  "conversationId": "550e8400-e29b-41d4-a716-446655440002",
  "referencedObservationId": "550e8400-e29b-41d4-a716-446655440003",
  "responseType": "changed",
  "optionalDescription": "Ejemplo enteramente ficticio.",
  "confirmationStatus": "student_confirmed",
  "source": "student_self_report",
  "createdAt": "2026-11-22T10:30:00.000Z"
}
```

## Reglas y garantías

- `unsure` y `prefer_not_to_answer` son respuestas válidas, pero no constituyen evidencia de cambio ni continuidad. No responder tampoco significa mejoría, ausencia o estabilidad.
- La descripción es opcional por contrato; si se proporciona, debe contener texto no vacío. No se almacena ni se transforma en este incremento.
- No se acepta como fuente `ai_generated` ni como confirmación `confirmed_by_ai`. Un validador Zod solo comprueba la forma: no prueba quién envió el valor ni puede impedir que un cliente falsifique campos.
- En un caso de uso futuro, el servidor tendría que obtener la identidad y ownership desde JWT, no confiar en `source`, `confirmationStatus`, IDs ni marcas temporales enviados por el cliente; fijar la fuente/confirmación tras una acción autenticada y explícita del estudiante.
- La confirmación acredita únicamente que el estudiante envió/aceptó su propia declaración para la operación correspondiente. No es confirmación profesional, verificación de exactitud, ni evaluación o diagnóstico clínico.

## Evolución en Sprint 5D.5

El campo original `referencedObservationId` no tenía un productor ni un ID por observación en los resultados. Se reemplazó en el contrato interno por `referencedObservation`, con `resultId` ya existente en `/signals/results`, índice dentro de `preliminaryGuidance.observations`, `sourceObservationIndex`, `field`, contexto y mensajes fuente. El contrato de declaración incrementó a versión `1.1`. No había endpoint ni cliente integrado, por lo que no se alteró un contrato HTTP expuesto.

La referencia debe resolverse contra el payload efímero original. No es estable entre ejecuciones y no sobrevive si se pierde dicho payload. Véase [Sprint 5D.5](sprint-5d5-ephemeral-observation-references.md).

## Compatibilidad y brecha de procedencia actual

`preliminaryGuidance` contiene `sourceObservationIndex`, `conversationId` y `sourceMessageIds`; no emite un ID UUID propio por observación. `MonitoringObservationReference` contempla un `observationId`, pero no existe actualmente una entidad productora/persistida de observaciones conversacionales que proporcione ese identificador. El contrato 1.1 ya no inventa tal UUID: su referencia compuesta identifica una fila solo dentro de un payload efímero. No ofrece resolución durable ni modifica `preliminaryGuidance`.

Antes de construir o consumir esta declaración se deberá definir cómo se crea y valida la referencia de observación (o si el contrato futuro debe referenciar explícitamente resultado efímero + índice + mensajes). No asumir que un UUID del cliente prueba que la observación existe, pertenece a la sesión o proviene de esa conversación.

## Privacidad y dependencias para un flujo futuro

El esquema en sí no accede a mensajes, Consent, repositorios, PostgreSQL, OpenAI ni otros servicios. Un caso de uso futuro deberá:

1. Exigir JWT y obtener `accountId` del contexto autenticado; comprobar propiedad de enrollment, sesión, conversación y observación, y correspondencia entre todos los IDs.
2. Comprobar consentimiento vigente `longitudinal_monitoring` y la autorización exacta para asociar/reutilizar la conversación histórica, con revalidación en los límites de lectura y escritura aplicables. El propósito de procesamiento/extracción no sustituye autorización longitudinal ni viceversa.
3. Mantener la asociación sesión-conversación bloqueada por defecto hasta revisión del aviso exacto; no suponer autorización retroactiva para mensajes de periodos anteriores.
4. No persistir la declaración o descripción hasta que responsables jurídicos/éticos definan finalidad, retención, corrección, retiro, exportación y supresión. El retiro no determina por sí solo qué hacer con datos previamente creados.
5. Ofrecer corrección/rechazo con semántica revisada. Una edición no debe sobrescribir silenciosamente una declaración previa si se decide conservar historia.

No se crean tablas, endpoints, migraciones o avisos. No se habilita asociación, lectura histórica, comparación, Safety, DASS-21 ni procesamiento automático.

## Pruebas

`tests/modules/longitudinal-monitoring/student-longitudinal-declaration.test.ts` verifica los cuatro tipos de respuesta, descripción opcional, combinaciones inválidas, IDs/fecha/versionado, fuente y confirmación no aceptadas, rechazo de campos extra y parseo determinista. Los fixtures son sintéticos.

Las decisiones pendientes incluyen la presentación y comprensión de las opciones, el texto de consentimiento y su alcance, corrección y tratamiento de declaraciones, ID fuente compatible, retención, y aprobación profesional/jurídica/ética antes de cualquier piloto.
