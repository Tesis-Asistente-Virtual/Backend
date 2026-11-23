# Sprint 6C.2 — adaptación conservadora de declaraciones longitudinales

## Decisión

No se implementa una función productiva que transforme automáticamente `StudentLongitudinalDeclaration` en una comparación. Con los contratos actuales no es posible establecer una correspondencia íntegra entre la referencia efímera declarada y la evidencia emparejada que requiere el comparador. Fabricar `temporalContext` a partir de `responseType` violaría la procedencia exigida.

Se añadió caracterización sintética para dejar fijada esta frontera: las respuestas `changed`, `continues`, `unsure` y `prefer_not_to_answer` no producen cambio o continuidad cuando los snapshots no contienen un vínculo temporal explícito válido.

## Incompatibilidades concretas

| Contrato | Información disponible | Información que falta para una adaptación segura |
| --- | --- | --- |
| Declaración voluntaria 1.1 | `responseType`, sesión/conversación actual, `referencedObservation` con `resultId`, índice de presentación, índice de observación fuente, campo y mensajes fuente; `source: student_self_report` y `confirmationStatus: student_confirmed`. | Una referencia a la observación del otro periodo y una afirmación temporal que vincule ambos periodos. La confirmación registra la acción del estudiante; no prueba el significado del texto ni constituye validación clínica. |
| Snapshot/comparador 1.1 | Sesión, conversación, fecha, mensajes seleccionados, observaciones `reported` por índice/campo y vínculo temporal estructurado en el snapshot posterior. | El snapshot no incluye `resultId` ni el índice de presentación de `preliminaryGuidance`. No puede demostrar que la observación comparada pertenece al resultado efímero exacto que el estudiante confirmó. |
| Resolución efímera | `BuildStudentLongitudinalDeclaration` resuelve la referencia contra el resultado exacto disponible durante esa operación y compara las versiones actuales de consentimiento con la procedencia de origen. | No hay adaptador de retención/resolución para solicitudes posteriores. Un resultado perdido o caducado no se puede reconstruir de forma segura a partir de datos reenviados por el cliente. |

Además, el comparador solo acepta una afirmación temporal explícita estructurada en el snapshot posterior. No la obtiene de texto ni interpreta el valor de `responseType`. El contrato de declaración referencia una observación individual; no define de qué observación anterior se habla.

## Comportamiento conservador

- `unsure` y `prefer_not_to_answer` no son evidencia de cambio ni continuidad.
- `changed` sin vínculo temporal verificable no permite comparar.
- `continues` sin vínculo temporal verificable no permite comparar.
- Observaciones reportadas en ambos snapshots no bastan por sí solas; el comparador requiere evidencia temporal explícita y referencias coincidentes.
- Referencias cruzadas, resultado no disponible, periodos no ordenables o falta de observaciones mantienen el rechazo o `insufficient_information` ya definido por los contratos existentes.
- No se modificaron los esquemas, las versiones, el comparador, los endpoints ni el comportamiento de autorización.

La prueba `tests/modules/longitudinal-monitoring/synthetic-longitudinal-demo.test.ts` usa dobles de consentimiento/propiedad y fixtures sintéticos para caracterizar esos casos. Cuando construye deliberadamente un vínculo temporal en el escenario demostrativo, ese vínculo es un input separado del comparador: no se deriva de la declaración. La salida sigue siendo descriptiva y estructural, no verifica semánticamente los mensajes fuente.

## Dependencias antes de reconsiderar la adaptación

1. Definir con revisión profesional, jurídica y ética si la declaración puede expresar una relación entre dos periodos y cómo se presenta la incertidumbre.
2. Aprobar finalidades y avisos que cubran reutilización de observaciones entre periodos; retirar, sustituir o carecer de consentimiento debe bloquear el flujo.
3. Resolver el resultado efímero exacto en servidor, acotado a propietario y versiones de consentimiento, o mantener bloqueada la operación posterior.
4. Si se aprueba ampliar el contrato, versionar una declaración que nombre explícitamente los dos periodos y sus referencias exactas. No reinterpretar silenciosamente la versión 1.1 ni aceptar identificadores aportados como prueba de propiedad.
5. Implementar después una función pura delgada que valide esa correspondencia y delegue la comparación al comparador existente; no duplicar sus reglas ni afirmar validación semántica.
6. Añadir pruebas de regresión y, solo después de autorizar la asociación real, pruebas HTTP/PostgreSQL aisladas con adaptadores de propiedad y consentimiento.

## Estado

No hay adaptación productiva ni comparación de estudiantes reales. La asociación sesión-conversación sigue bloqueada en producción. No se añadieron endpoints, tablas, persistencia, migraciones, llamadas a proveedores ni reglas clínicas.
