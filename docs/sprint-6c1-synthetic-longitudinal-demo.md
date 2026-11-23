# Sprint 6C.1 — demostración interna sintética de seguimiento conversacional

## Objetivo y alcance

Esta demostración muestra, mediante pruebas unitarias y datos ficticios, cómo se relacionan dos sesiones con resultados conversacionales efímeros, referencias a observaciones, declaraciones voluntarias y el comparador descriptivo existente. No añade un flujo disponible para participantes.

No se usan PostgreSQL, HTTP, proveedores de IA ni servicios externos. Los resultados y declaraciones viven solo durante cada prueba. No se agregan datos persistentes, contenido de usuarios, puntuaciones, diagnósticos, categorías clínicas ni lógica de Safety.

## Composición ejercitada

La prueba `tests/modules/longitudinal-monitoring/synthetic-longitudinal-demo.test.ts` reutiliza estas funciones y contratos existentes:

1. `createConversationSignalResult` construye resultados sintéticos de dos conversaciones diferentes, cada una con una observación `reported` referida a un mensaje propio.
2. `createPreliminaryConversationGuidance` deriva la guía desde los hechos reportados del resultado, sin nueva llamada al modelo.
3. `createConversationResultObservationReference` emite una referencia determinista acotada al `resultId`, `conversationId`, índice y mensajes fuente de cada resultado.
4. `BuildStudentLongitudinalDeclaration` valida por dobles la propiedad, la sesión abierta, la asociación, el alcance de avisos y las tres autorizaciones actuales; luego construye una declaración de estudiante en memoria para cada periodo.
5. `compareLongitudinalConversationSnapshots` procesa dos snapshots sintéticos ordenados y una relación temporal explícita en el segundo snapshot; devuelve evidencia estructural por periodo sin devolver texto de observaciones.

Los dobles simulan la misma cuenta propietaria, dos sesiones distintas bajo una inscripción, asociación verificada y concesiones vigentes para `longitudinal_monitoring`, `ai_conversation_processing` y `structured_signal_extraction`. Estas simulaciones no prueban la integración de adaptadores reales ni publican consentimiento.

## Límite entre declaración y comparación

La declaración 1.1 (`continues`, `changed`, `unsure` o `prefer_not_to_answer`) refiere a una observación de un resultado y registra una respuesta voluntaria. No contiene los identificadores de la observación anterior y posterior, ni produce el `temporalContext` requerido por el comparador 1.1. Por ello, la prueba construye ese vínculo como dato sintético separado. No hay un mapeo productivo entre `responseType: changed` y `temporalContext.relation: change` y no se afirma que el comparador compruebe que las palabras fuente respaldan la relación.

El resultado `explicit_change_reported` de la prueba solo demuestra que el contrato del comparador acepta la relación explícita simulada y que sus referencias estructurales concuerdan. No demuestra semántica, interpretación psicológica, mejoría, deterioro ni validación profesional.

## Casos cubiertos

- Dos periodos, conversaciones, sesiones y conjuntos de mensajes sintéticos distintos, bajo una misma cuenta.
- Referencias de observación resueltas contra cada resultado efímero correspondiente.
- Declaraciones voluntarias sintéticas para los dos periodos y comparación con vínculo temporal explícito.
- Denegación cuando falta una de las autorizaciones requeridas.
- Rechazo de referencia con mensaje fuente cruzado.
- Rechazo cuando el resultado efímero dejó de estar disponible.
- `prefer_not_to_answer` sin transformarlo en evidencia de continuidad o cambio.
- `insufficient_information` cuando falta el vínculo temporal, falta evidencia en un periodo o el orden temporal no es válido.
- Salida del comparador sin texto fuente, score ni diagnóstico.

Las pruebas unitarias existentes del constructor cubren además propiedad incorrecta, aviso sustituido, fallo de autorización y contexto inactivo; las pruebas del comparador cubren IDs cruzados, evidencia ajena, periodos repetidos y otros casos estructurales.

## Estado de activación

La asociación sesión-conversación continúa bloqueada en producción. `BuildStudentLongitudinalDeclaration` no está registrado en un endpoint o flujo productivo y no existe un adaptador que conserve y resuelva resultados efímeros en solicitudes posteriores. El contexto y los resultados usados aquí son fixtures, no una autorización para reutilizar conversaciones reales.

Antes de cualquier integración hacen falta, como mínimo:

- autorización profesional, jurídica y ética del uso secundario y de la relación entre sesiones;
- avisos y consentimiento que cubran el alcance concreto, con resolución de retiro y sustitución;
- una estrategia aprobada para disponibilidad, expiración y eliminación del resultado exacto, o mantener la declaración bloqueada;
- definición de cómo la declaración voluntaria se vincula —si corresponde— a una afirmación temporal del comparador, incluida corrección y rechazo;
- revisión profesional de los textos mostrados y de los límites de interpretación;
- adaptadores reales para autenticación/propiedad, asociación y consentimiento, además de pruebas HTTP y PostgreSQL aisladas.

## Verificación

La verificación de este incremento se realiza con `npm run typecheck`, `npm run build` y `npm test`. No requiere configuración de base de datos ni migración.
