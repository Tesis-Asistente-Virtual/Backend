# Sprint 7A.1 — preparación para una futura prueba controlada con IA real

**Estado:** preparación técnica completada; no se realizaron llamadas a OpenAI. Esta revisión no constituye validación clínica, autorización para datos reales ni aprobación ética o jurídica.

## Resumen de integración

La aplicación usa el SDK `openai` y la Responses API en dos adaptadores:

- `OpenAiTextGenerator`: respuestas REST y streaming SSE para conversación.
- `OpenAiConversationSignalExtractor`: extracción estructurada bajo solicitud explícita; `/signals/results` obtiene la extracción una vez por solicitud y construye un resultado efímero.

Ambos adaptadores toman el modelo y los límites de `src/config/env.ts`; no usan respuestas previas remotas (`previous_response_id` o `conversation`). Los requests fijan `store: false`, `tools: []`, un límite de salida y timeout, y `maxRetries: 0`. El extractor usa salida estructurada estricta con el esquema Zod existente. No se añade lógica de scoring, Safety ni procesamiento automático.

## Hallazgo y corrección

El generador no streaming confiaba completamente en el tipo TypeScript de la respuesta del SDK al acceder a `output_text.trim()` y al mapear `usage`. Una respuesta malformada podía causar un `TypeError` genérico o dejar pasar valores de uso inválidos. Se añadió validación explícita del tipo de texto y se reutilizó la validación estricta de `usage` que ya aplica el camino streaming. Las fallas se clasifican como `OpenAiTextGenerationError` seguro, sin mensajes del proveedor.

No se cambiaron prompts, endpoints, límites de dominio, consentimiento ni persistencia.

## Controles comprobados en código y pruebas

| Área | Estado observado |
| --- | --- |
| Modelos | Se usa `OPENAI_MODEL`; no hay fallback silencioso a un nombre fijo. La clave se requiere solo al construir el adaptador. |
| Entrada/salida | Conversación limita mensajes, caracteres y tokens solicitados contra configuración. Extracción valida el input y schema de salida; se envía solo el conjunto explícito de mensajes completos autorizados. |
| Privacidad del request | `store: false`, `tools: []`; no se envían referencias de conversación remotas. No se registran prompts ni contenido en el observador de SSE. |
| Timeouts/reintentos | Timeout configurable (`OPENAI_TIMEOUT_MS`, default actual 30 000 ms), máximo de tokens/contexto configurable, reintentos automáticos desactivados (`maxRetries: 0`). |
| Errores y rate limit | REST y streaming convierten errores del proveedor a categorías tipadas y no exponen mensajes crudos. El 429 se clasifica como `rate_limit` en generación de texto y como `provider_unavailable` en extracción. No hay retry automático; el llamador recibe fallo controlado. |
| Cancelación | SSE conecta desconexión del cliente con `AbortSignal` y lo pasa al SDK. La extracción también pasa la señal de desconexión al adaptador y no devuelve una respuesta después de abortar. La ruta REST de generación no dispone de cancelación de cliente en el puerto actual. |
| Persistencia | Conversación persiste mensajes del estudiante y respuesta completada; ante generación fallida se registra un mensaje asistente fallido vacío. Extracción y resultado descriptivo no persisten su salida. `store: false` no debe interpretarse como garantía de retención cero del proveedor. |
| Llamadas duplicadas | Una llamada a `/signals/results` invoca la extracción una vez. Solicitudes HTTP repetidas o reintentos del cliente son solicitudes nuevas y pueden volver a invocar el proveedor; no existe idempotency key ni deduplicación entre solicitudes. |
| Logging | `ConsoleConversationStreamObserver` registra operación, etapa y categorías cerradas; no recibe texto de usuario, prompt, respuesta ni error crudo del SDK. |
| Prompts | Instrucciones conversacionales contienen límites no diagnósticos y una indicación genérica de buscar apoyo humano en crisis; no constituyen detección o protocolo de Safety. Las instrucciones del extractor prohíben diagnósticos, severidad y conclusiones de riesgo. La instrucción del extractor tiene versión `1.0.0`; la de conversación no expone una versión independiente. |

Las pruebas existentes con mocks cubren respuestas correctas, salidas vacías/malformadas, rate limit, timeout, autenticación del proveedor, desconexión, cancelación, eventos SSE parciales, reintentos desactivados, ausencia de logs sensibles, extracción única por solicitud, validación de referencias y consentimiento antes de transferencia. No llaman a OpenAI.

## Configuración para operador

La composición normal lee:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS` (default `30000`)
- `OPENAI_MAX_OUTPUT_TOKENS` (default `800`)
- `OPENAI_MAX_CONTEXT_MESSAGES` (default `20`)
- `OPENAI_MAX_CONTEXT_CHARACTERS` (default `24000`)

Los cuatro límites numéricos se validan como enteros positivos, pero no tienen un máximo absoluto de configuración en este incremento. Para una prueba se deben escoger valores explícitos y conservadores aprobados por el responsable técnico; un máximo configurado grande permite requests igualmente grandes. No se deben copiar claves a `.env` del repositorio, tickets, documentación, historial de shell o logs. Proveer secretos solo mediante el gestor/entorno local autorizado y comprobar presencia sin imprimir valores.

`npm run demo:server` verifica primero `DEMO_DATABASE_URL` como PostgreSQL loopback y `tesis_demo_db`, y luego arranca la composición Express normal en ese proceso, asignando allí la URL validada a `DATABASE_URL`. Si se proporcionan clave y modelo, los endpoints de conversación/extracción usan OpenAI real. El comando `npm run demo:conversational` usa fakes; no es una prueba del proveedor real. No usar `npm run dev` para esta prueba: ese proceso utiliza la configuración normal de base de datos.

## Prueba manual opcional con adaptadores reales

El script `scripts/run-synthetic-openai-check.ts` reutiliza `OpenAiTextGenerator` y `OpenAiConversationSignalExtractor`. No requiere servidor, HTTP, SSE ni PostgreSQL: hace una llamada no streaming de generación y una llamada de extracción estructurada, como máximo una a cada adaptador. La extracción usa el texto fijo sintético de este documento; el texto no se acepta por argumentos.

El script previo `manual:test-signal-extraction`, que podía realizar tres llamadas de extracción, queda deshabilitado y solo imprime una indicación para usar el nuevo comando. Así no queda una ruta manual paralela con más solicitudes.

Está deshabilitado salvo que se proporcionen **ambos** argumentos exactos:

- `--run-synthetic-openai-check`
- `--confirm-synthetic-only`

Requiere además `OPENAI_API_KEY`, `OPENAI_MODEL` y `NODE_ENV` distinto de `production`. Argumentos adicionales provocan rechazo. El script fija timeout de 15 segundos por solicitud, contexto de un mensaje y 1.000 caracteres. Los presupuestos de salida están separados: 256 tokens para generación y 1.200 para extracción estructurada. No usa retries ni loops. Duración máxima nominal combinada: 30 segundos, sujeta al cierre de cada llamada por el SDK.

Comando manual futuro, solo desde una terminal local protegida y tras autorización explícita de la ejecución/costo:

```powershell
npm run ai:check:synthetic -- --run-synthetic-openai-check --confirm-synthetic-only
```

Las variables de clave y modelo deben estar provistas en el entorno local seguro antes de ejecutar el comando; no se documentan ni se pasan como argumentos. El output es un único resumen JSON con estados, categorías técnicas cerradas y, si es válido, conteos de tokens de generación. Nunca imprime texto generado, observaciones, prompt, clave ni mensaje crudo del SDK. El script no consulta ni registra Consent: el contenido está fijado en código y es puramente ficticio, y las llamadas son directas a los adaptadores, no a una ruta de participantes. Por ello **no prueba** JWT, ownership, consentimiento, límites HTTP ni flujo REST/SSE.

La forma JSON esperada del reporte es similar a:

```json
{
  "operation": "synthetic_openai_check",
  "syntheticOnly": true,
  "generation": { "status": "completed" },
  "extraction": { "status": "validated" },
  "generationUsage": { "inputTokens": 25, "outputTokens": 18, "totalTokens": 43 }
}
```

El ejemplo es ilustrativo, no el resultado de una ejecución real. Una falla se reporta con `errorKind` seguro y código de salida distinto de cero. Antes de invocar realmente al proveedor, confirmar cuenta/proyecto OpenAI, modelo disponible, controles de uso/retención aplicables, costo y condiciones organizacionales con sus responsables; este script no verifica esas condiciones.

## Riesgos y bloqueos antes de ampliar pruebas

- La configuración limita requests por valores desplegados, pero no impone techos absolutos; hay que aprobar valores para el ambiente y evaluar límites de gasto/abuso fuera del alcance de este cambio.
- Un retry del usuario puede generar una segunda transferencia/costo; idempotencia o deduplicación requeriría una decisión de producto y privacidad porque los resultados son efímeros. El script manual no reintenta.
- En SSE, los deltas ya enviados no se pueden retirar si después falla el proveedor, persiste el mensaje o se detecta cancelación. El contrato comunica fallo y no marca el turno completado.
- La prueba solo debe usar entradas sintéticas. No se revisó ni aprobó el tratamiento del proveedor para datos reales, ubicación/retención, acceso operativo, ni obligaciones aplicables.
- Los prompts protegen por instrucciones, no por un control clínico validado. El contenido conversacional y las instrucciones de crisis requieren revisión profesional; Safety permanece desactivado y no existe detección automática aprobada.
- Los avisos de `tesis_demo_db` son fixtures marcados de demostración y no sustituyen consentimiento válido para participantes.
- No se cubren con una prueba de red del proveedor real. Tests de SDK usan clientes simulados. La prueba manual descrita aquí sigue sin ejecutarse.

## Criterios de aceptación para una futura prueba

- Dos argumentos de activación exactos, clave/modelo presentes y `NODE_ENV` no productivo.
- Una llamada de generación y una de extracción como máximo; límites y timeout conservadores, sin retry.
- Mensaje fijo sintético, sin identificadores personales ni argumentos de contenido.
- Resumen sin prompt, respuesta, observaciones ni secretos; errores categorizados y uso de tokens solo si es válido.
- Sin servidor, endpoint, DB, persistencia, Safety, scoring ni monitoreo longitudinal en la prueba manual.
- Clave y modelo proporcionados fuera de archivos versionados; costos y límites revisados por responsables.
- Esta prueba de adaptadores directos no equivale a consentimiento ni valida el flujo HTTP; usar únicamente para una prueba técnica interna sintética.
- Revisar respuesta y prompt con profesional antes de cualquier prueba con participantes; revisión jurídica/ética y protocolo de datos antes de uso real.
- Safety, DASS-21 público y monitoreo longitudinal continúan desactivados.

## Sprint 7A.3 — investigación de respuestas inválidas

La ejecución real reportada anteriormente mostró `generation: invalid_response` y `extraction: incomplete_response`. Esos dos códigos, por sí solos, no permiten atribuir el problema a OpenAI, al modelo configurado, al límite de salida ni al adaptador: la salida anterior no conservó `response.status`, `incomplete_details.reason` ni la etapa local de validación. No se repitió ninguna llamada real para esta investigación.

**Defecto confirmado en código:** generación no streaming tenía una ruta de validación independiente que agrupaba cualquier estado distinto de `completed` bajo `invalid_response`. El camino de streaming ya reconocía `incomplete`. Ahora la generación no streaming comparte el validador del resultado final; clasifica `incomplete` como `incomplete_response` (motivo cerrado `max_output_tokens` u `other`), `failed` como `provider`, y estados no terminales/desconocidos como `invalid_response`. Texto ausente/malformado, texto vacío, error de respuesta completada y uso de tokens inválido continúan rechazándose.

El extractor structured output ya rechazaba respuestas `incomplete` y rechazos del modelo sin aceptar `output_parsed`. Ahora conserva, para diagnóstico interno seguro, únicamente la distinción `max_output_tokens` frente a `other`; causas como `content_filter`, `max_messages` y `steered` se agrupan en `other`. No se transmite el detalle libre del SDK.

El script manual incluye ahora `failureStage` e `incompleteReason` solo cuando son valores enumerados por el backend. No incluye mensajes, prompts, texto, payloads ni códigos arbitrarios del proveedor. Las pruebas usan respuestas SDK simuladas; incluyen completion válida, incomplete por límite, respuesta fallida/no terminal, uso inválido, texto vacío, rechazo estructurado, timeout y error de proveedor. No acceden a red.

**Hipótesis no verificadas:** la llamada real de generación pudo haber recibido una respuesta incompleta, un `output_text` vacío/ausente, usage malformado, estado inesperado u otro contrato no conforme. La extracción pudo detenerse por límite de salida, filtro u otra causa de incompletitud; tampoco puede descartarse incompatibilidad del modelo con la modalidad Structured Outputs sin inspeccionar un estado seguro devuelto por una ejecución controlada. El SDK tipa `incomplete_details.reason` como `max_output_tokens`, `max_messages`, `content_filter` o `steered`; la aplicación conserva solo una categoría reducida.

**Siguiente diagnóstico seguro:** en la próxima prueba manual ya autorizada, revisar únicamente los nuevos campos cerrados del resumen. Si extracción devuelve `incomplete_response / max_output_tokens`, evaluar por separado el presupuesto aprobado y la salida estructurada, con fixture/mock primero. Si devuelve `other`, no inferir compatibilidad ni causa; se requeriría una captura de metadatos permitidos sin payload y revisión de documentación/modelo. No repetir llamadas con datos reales ni desactivar validación Zod.

No se alteraron prompts, límites, contratos HTTP, consentimiento, almacenamiento, PostgreSQL ni configuración. No se ejecutó el script real.

## Sprint 7A.4 — presupuestos sintéticos separados

La prueba manual anterior enviaba `max_output_tokens=160` tanto a generación como a extracción. La ejecución real reportada mostró `incomplete_response` con `incompleteReason=max_output_tokens` en ambas respuestas. Esto confirma agotamiento del presupuesto reportado, no una incompatibilidad del modelo ni un defecto de Zod.

El script ahora fija presupuestos independientes: **256** para generación conversacional y **1.200** para la salida JSON estructurada. El primer presupuesto cubre una respuesta breve de demostración; el segundo da espacio adicional para los campos requeridos por `conversationSignalExtractionSchema`, aun con una sola entrada sintética. Los valores son fijos, revisables en código y no se pueden aumentar desde el entorno o argumentos. Guardas prueban los rangos permitidos (generación 128–512; extracción 768–2.048) y fallan cerradas ante valores fuera de rango o no enteros.

`max_output_tokens` limita todos los tokens de salida; en modelos de razonamiento incluye tokens no visibles además del texto o JSON. Por tanto, 256/1.200 son presupuestos acotados para esta prueba, no garantía de completitud para todo modelo. No se fija un modelo ni se cambian prompts en este incremento. Si vuelve a agotarse el límite, el script reportará la categoría sin aceptar salida parcial ni subir automáticamente el presupuesto. La documentación oficial explica el estado `incomplete`, el uso de tokens de razonamiento y el límite de salida [en la guía de razonamiento de Responses](https://developers.openai.com/api/docs/guides/reasoning); la disponibilidad y requisitos de Structured Outputs dependen del modelo y del esquema [según la guía oficial](https://developers.openai.com/api/docs/guides/structured-outputs).

El coste máximo atribuible a tokens depende del modelo configurado y de sus precios vigentes. Esta prueba permite como máximo dos requests (uno por operación), 1.456 tokens máximos de salida combinados y un mensaje sintético con límite de 1.000 caracteres por request, además de las instrucciones fijas del adaptador; también se factura el input. No se estima un costo monetario sin fijar y verificar el modelo y su tarifa. Los tokens consumidos por razonamiento pueden cobrarse aunque no haya texto visible; una salida incompleta no se considera éxito.

Procedimiento futuro de una sola ejecución, desde terminal local autorizada: comprobar antes la identidad del modelo configurado y el costo aceptable; confirmar presencia de `OPENAI_API_KEY` y `OPENAI_MODEL` sin imprimir sus valores; ejecutar una vez:

```powershell
npm run ai:check:synthetic -- --run-synthetic-openai-check --confirm-synthetic-only
```

El comando no debe repetirse automáticamente ante una falla. Debe revisarse únicamente el resumen de estado, `errorKind`, `failureStage`, `incompleteReason` y conteos de uso validados; nunca se deben copiar prompts, respuestas o errores crudos. El escenario permanece sintético y fijo. No usar datos de estudiantes ni interpretar una respuesta como resultado clínico.

Las pruebas con mocks verifican los límites mínimo/máximo, presupuestos distintos, ignorancia de valores de tokens ambientales, máximo de llamadas, error por agotamiento y ausencia de secretos. No se efectuaron llamadas reales.

## Archivos de este incremento

- `src/modules/conversations/infrastructure/openai/openai-text-generator.ts`: validación cerrada de texto y usage no streaming.
- `tests/modules/conversations/openai-text-generator.test.ts`: regresiones para respuesta y usage malformados.
- `scripts/run-synthetic-openai-check.ts`: prueba manual bloqueada por defecto y limitada a datos sintéticos.
- `scripts/manual-test-signal-extraction.ts`: shim deprecado sin adaptador ni llamadas al proveedor.
- `tests/scripts/run-synthetic-openai-check.test.ts`: mocks de activación, configuración, límites de llamadas y redacción de logs.
- `docs/sprint-7a1-real-ai-readiness.md`: hallazgos, procedimiento futuro y bloqueos.
