# Guía de demostración frontend: conversación y resultado descriptivo

## Alcance y modos de demostración

Esta guía describe el flujo existente, sin agregar endpoints ni persistir resultados de extracción. El orden es: autenticación → lectura y decisión expresa de consentimientos → conversación → selección de mensajes completados → extracción explícita → resultado descriptivo efímero.

Hay dos formas de demostrarlo:

1. **Modo simulado automatizado:** sigue [`docs/sprint-4c4-demo-environment.md`](sprint-4c4-demo-environment.md): `npm run demo:conversational` verifica mediante `DEMO_DATABASE_URL` una base loopback exacta `tesis_demo_db`, luego ejecuta un harness HTTP efímero con PostgreSQL real, cuenta/JWT sintéticos, avisos y decisiones de consentimiento de esa base, conversación, extracción y resultado con proveedores simulados. No llama a OpenAI. El comando no usa `DATABASE_URL` ni `TEST_DATABASE_URL` como fallback. Las cuentas sintéticas generadas se limpian al terminar; los avisos demo permanecen inmutables.
2. **Modo manual con proveedor configurado:** las llamadas HTTP a mensajes REST/SSE y a `/signals/extract` o `/signals/results` invocan los adaptadores configurados. Si OpenAI está habilitado, cada una puede realizar una solicitud real al proveedor. Los comandos siguientes son ejemplos para ejecución manual y no se ejecutaron como parte de esta tarea. No hay una ruta HTTP de mock ni un bypass de consentimiento.

Los ejemplos usan una cuenta, correo y mensajes sintéticos. No pegues tokens en tickets, capturas, logs o repositorios. El backend persiste los mensajes de chat; **el resultado de señales no se persiste** y su ID no permite recuperarlo después.

## Antes de empezar

- Inicia el servidor de desarrollo con la configuración local que ya uses y confirma que `http://localhost:3000/health` responde.
- El comando del proyecto es `npm run dev` (usa `tsx watch src/server.ts`). Antes de ejecutar cualquier POST de esta guía, verifica de forma segura que la conexión configurada para esa instancia apunta a una base local aislada para demostración, nunca a `tesis_db` ni a producción. Registro, decisiones de consentimiento y mensajes de chat escriben datos persistentes.
- Abre Swagger en `http://localhost:3000/api-docs` para ver el OpenAPI servido por esa instancia.
- No se verificó el contenido de ninguna base en esta tarea. Los avisos disponibles se obtienen de `GET /api/v1/consents/notices`. Si la respuesta es `[]` o falta una de las dos finalidades, el flujo de extracción está bloqueado: no publiques ni inventes un aviso para la demo. En pruebas automatizadas pueden existir fixtures explícitamente no legales en la base de pruebas protegida; no los uses como avisos de una demostración real.
- Para realizar el modo manual completo debe estar configurado el proveedor de generación. En ese modo, enviar un mensaje, extraer señales y generar el resultado son acciones explícitas que pueden invocar OpenAI. No se inicia ninguna de ellas al arrancar el servidor.

**Validación de Sprint 4C.2 (2026-11-21):** el intento de lectura a `GET /health` en `localhost:3000` no encontró un servidor disponible; el GET no destructivo de `/api/v1/consents/notices` tampoco estuvo disponible. Por ello, el estado de los avisos era **desconocido en ese ambiente**, no se concluyó que estuvieran ausentes. Para el harness simulado se usa la base dedicada `tesis_demo_db`; para HTTP manual, primero verifica una instancia local aislada y los avisos aplicables.

Para ejecutar la variante automatizada aislada, sigue las instrucciones de Sprint 4C.4: verificar `DEMO_DATABASE_URL`, aplicar previamente las migraciones autorizadas y cargar fixtures solo en `tesis_demo_db`. Los avisos marcados como “SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS” no son avisos jurídicos ni base para una demostración con participantes. El flujo manual descrito abajo requiere una base de demo aislada, avisos formalmente aprobados y proveedor configurado.

## Flujo reproducible con PowerShell

Las rutas y cuerpos están derivados de los schemas Zod y controladores actuales. Requieren que el servidor escuche en `http://localhost:3000`.

### 1. Crear cuenta de demostración e iniciar sesión

El schema de registro acepta `email` y `password` (mínimo 12 caracteres) y rechaza campos extra. Usa un correo ficticio con dominio reservado `.example.test`. Si la cuenta ya existe, omite el registro e inicia sesión.

```powershell
$BaseUrl = 'http://localhost:3000'
$Email = "demo-$([guid]::NewGuid().ToString('N'))@example.test"
$Password = 'Demo-Local-Only-2026!'

$signupBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$signup = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/auth/sign-up" -ContentType 'application/json' -Body $signupBody

$signinBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$tokens = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/auth/sign-in" -ContentType 'application/json' -Body $signinBody
$AuthHeaders = @{ Authorization = "Bearer $($tokens.accessToken)" }
```

`POST /auth/sign-up` responde `201` con `{ id, email, message }`. `POST /auth/sign-in` responde `200` con `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn }`. Para las rutas privadas se envía el access token en el header Bearer; `accountId` no se envía en el body.

### 2. Leer avisos y registrar decisiones explícitas

`GET /api/v1/consents/notices` es público y devuelve un arreglo de avisos efectivos publicados, cada uno con `{ id, purpose, version, content, effectiveAt }`. Presenta el texto real del aviso antes de pedir una decisión. Se requieren decisiones separadas `granted` para `ai_conversation_processing` y `structured_signal_extraction`.

El siguiente bloque **no concede consentimiento automáticamente**: imprime cada aviso y continúa solo si quien opera confirma expresamente `grant` después de revisarlo. Si no hay aviso para cualquiera de las finalidades, se detiene.

```powershell
$notices = @(Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/consents/notices")
$purposes = @('ai_conversation_processing', 'structured_signal_extraction')

foreach ($purpose in $purposes) {
  $notice = $notices | Where-Object { $_.purpose -eq $purpose } | Select-Object -First 1
  if (-not $notice) { throw "No hay aviso publicado para $purpose; la demo no puede continuar." }

  Write-Host "Finalidad: $($notice.purpose) | Aviso: $($notice.version)"
  Write-Host $notice.content
  $decision = Read-Host 'Escribe grant solo si la persona decide aceptar este aviso; cualquier otra respuesta detiene este paso'
  if ($decision -cne 'grant') { throw "No se registró aceptación para $purpose." }

  $decisionBody = @{
    purpose = $purpose
    noticeVersionId = $notice.id
    action = 'granted'
    idempotencyKey = [guid]::NewGuid().ToString()
  } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/consents/me/decisions" -Headers $AuthHeaders -ContentType 'application/json' -Body $decisionBody | Out-Null
}

$consentStatus = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/consents/me" -Headers $AuthHeaders
$consentStatus.items | Format-Table purpose, state, currentNoticeVersion
```

El body exacto de decisión es `{ purpose, noticeVersionId, action, idempotencyKey }`; todos son obligatorios, la clave es UUID y no se aceptan propiedades extra. La respuesta `201` contiene `{ id, purpose, noticeVersionId, action, createdAt }`. No registres aceptación en nombre de otra persona ni uses avisos de prueba no legales como base para tratar datos en una demo con personas.

### 3. Crear conversación y enviar un mensaje sintético

`POST /api/v1/conversations` requiere JWT; el body admite `{ title? }`, donde title es opcional, nullable y máximo 150 caracteres. La respuesta `201` contiene `{ id, title, status, createdAt, updatedAt }`.

```powershell
$conversationBody = @{ title = 'Demo sintética de organización académica' } | ConvertTo-Json -Compress
$conversation = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/conversations" -Headers $AuthHeaders -ContentType 'application/json' -Body $conversationBody
$ConversationId = $conversation.id

$messageBody = @{ content = 'Estoy organizando las tareas de un proyecto ficticio de clase y quiero ordenar los próximos pasos.' } | ConvertTo-Json -Compress
$turn = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/conversations/$ConversationId/messages" -Headers $AuthHeaders -ContentType 'application/json' -Body $messageBody
$turn | ConvertTo-Json -Depth 10
```

El body de mensaje es `{ content }`, texto no vacío tras `trim()` y máximo 5000 caracteres. El envío REST devuelve `201` con `{ userMessage, assistantMessage }`; cada mensaje contiene `{ id, conversationId, role, content, status, createdAt }`. Este paso guarda ambos mensajes y, en modo manual con proveedor configurado, solicita una respuesta del asistente.

### 4. Variante SSE

En lugar del POST REST anterior, se puede enviar el mismo body a `/messages/stream`. `curl.exe -N` permite ver los eventos progresivamente:

```powershell
$sseBody = @{ content = 'Mensaje académico ficticio para demostrar el flujo de streaming.' } | ConvertTo-Json -Compress
curl.exe -N -X POST "$BaseUrl/api/v1/conversations/$ConversationId/messages/stream" `
  -H "Authorization: Bearer $($tokens.accessToken)" `
  -H 'Content-Type: application/json' `
  --data-raw $sseBody
```

Los eventos de éxito incluyen `message.started`, cero o más `message.delta`, `message.completed` y `stream.completed`; un fallo después de abrir SSE se comunica con `stream.error`. El turno usa generación del asistente y puede invocar OpenAI. SSE es una variante de envío; no es necesario ejecutar REST y SSE para el mismo mensaje.

### 5. Consultar mensajes y elegir referencias

```powershell
$page = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/conversations/$ConversationId/messages?limit=20&offset=0" -Headers $AuthHeaders
$page | ConvertTo-Json -Depth 10

$sourceMessages = @($page.items | Where-Object { $_.status -eq 'completed' })
$messageIds = @($sourceMessages | ForEach-Object { $_.id })
```

La respuesta es `{ items, pagination: { limit, offset, hasMore } }`. Solo selecciona IDs de mensajes completados que pertenezcan a esta conversación; la extracción vuelve a validar propiedad y estado. El request admite de 1 a 20 UUID únicos. Si prefieres limitar la demostración a un mensaje seleccionado:

```powershell
$lastUserMessage = $sourceMessages | Where-Object { $_.role -eq 'user' } | Select-Object -Last 1
if (-not $lastUserMessage) { throw 'No hay mensaje user completado para seleccionar.' }
$messageIds = @($lastUserMessage.id)
```

### 6. Solicitar extracción explícita y resultado descriptivo

La extracción y la generación del resultado son dos acciones explícitas distintas. Cada POST invoca el extractor otra vez; `/results` no lee una extracción anterior. El resultado no se persiste, no tiene GET posterior y `id` es efímero.

```powershell
$extractBody = @{ messageIds = $messageIds } | ConvertTo-Json -Compress
$extraction = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/conversations/$ConversationId/signals/extract" -Headers $AuthHeaders -ContentType 'application/json' -Body $extractBody
$extraction | ConvertTo-Json -Depth 15

$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/conversations/$ConversationId/signals/results" -Headers $AuthHeaders -ContentType 'application/json' -Body $extractBody
$result | ConvertTo-Json -Depth 20
```

El contrato de `/signals/extract` permanece `{ status, schemaVersion, observations, missingInformation, clarificationQuestions }`. El resultado de `/signals/results` tiene exactamente estos campos en su schema público: `{ status, id, conversationId, generatedAt, schemaVersion, extractorVersion, sourceMessageIds, observations, missingInformation, clarificationQuestions, summary, preliminaryGuidance }`. No incluye `accountId`.

`preliminaryGuidance` tiene `{ contractVersion, conversationId, sourceMessageIds, observations, informationGaps, suggestedFollowUpQuestions, generalGuidance, limitations }`. La prueba integrada automatizada comprueba que las observaciones de la guía provengan de observaciones `reported` y referencien únicamente los mensajes seleccionados; también verifica brechas, preguntas opcionales, textos fijos y ausencia de campos de diagnóstico o puntuaciones.

Dentro de `summary`:

- `descriptiveStatus`: `observations_available` o `no_observations`.
- `reportedFacts`: hechos derivados determinísticamente de los campos cuyo estado de evidencia sea `reported`; incluyen `observationIndex`, `field`, `value`, `sourceMessageIds` y `contextDomain` cuando corresponda.
- `emptyObservationsMeaning`: siempre `not_evidence_of_absence`.
- `interpretationLimits`: `descriptive_only`, `not_a_diagnosis`, `clinical_severity_not_calculated`, `not_a_safety_assessment`.

Cada observación conserva `evidence`, `manifestation`, `possibleDimensions`, `duration`, `frequency`, `intensity`, `contexts`, `functionalImpact` y `sourceMessageIds`, conforme a `SignalObservation`. Los valores de evidencia pueden ser `reported`, `ambiguous`, `not_reported` o `not_assessed`. No hay puntuaciones, niveles clínicos ni evaluación Safety.

## Manejo sugerido en frontend

Una pantalla de conversación puede mostrar mensajes por rol y un botón **“Analizar conversación”** deshabilitado mientras haya una solicitud activa. Al pulsarlo:

1. Selecciona uno o más mensajes `completed` de la conversación actual.
2. Muestra estado de carga separado para extracción/resultado; evita reintentos silenciosos porque repetir la solicitud vuelve a llamar al proveedor.
3. Presenta `observations` como observaciones tentativas, `missingInformation` como campos no disponibles y `clarificationQuestions` como preguntas sugeridas que la persona puede ignorar.
4. Muestra `summary.interpretationLimits` en contexto. Si `descriptiveStatus` es `no_observations`, muestra que no se encontraron observaciones en los mensajes seleccionados; no lo presentes como ausencia de síntomas o peligro.
5. Maneja al menos: `401` sesión inválida; `403` consentimiento requerido/retirado; `404` conversación ajena o inexistente; `400` solicitud o referencias inválidas; `503` autorización o extractor no disponible. No muestres stack, payloads del proveedor ni texto de errores internos.

El resumen debe estar ligado solo a la respuesta en memoria de la interfaz; al cerrar o recargar la vista no se puede recuperar del servidor. La demo no guarda resultados ni crea snapshots longitudinales.

## Comprobaciones de autorización y límites

- La identidad se obtiene del JWT; no envíes `accountId`.
- La conversación debe pertenecer a la cuenta. Una conversación ajena o inexistente responde `404` para no revelar existencia.
- Los mensajes seleccionados deben pertenecer a esa conversación y estar `completed`; no se pasan mensajes fallidos o incompletos al extractor.
- Se exigen por separado los consentimientos vigentes `ai_conversation_processing` y `structured_signal_extraction`; la verificación falla cerrada y se repite antes de enviar el contenido al extractor.
- Si falta o se retiró un consentimiento, la petición responde `403` y no llama al extractor. El JWT no equivale a consentimiento.
- `/signals/extract` y `/signals/results` no agregan ni modifican mensajes; REST/SSE del chat sí persisten mensajes conversacionales según su contrato.
- Las observaciones son descriptivas y tentativas. No son diagnóstico, escala psicométrica, nivel de severidad, predicción ni evaluación de seguridad. Safety y DASS-21 no se activan.

## Pruebas disponibles

`npm test` ejecuta pruebas unitarias con dobles, excluyendo `tests/integration/**`. `npm run demo:conversational` ejecuta específicamente `tests/integration/conversational-demo.integration.test.ts`: usa la guarda `DEMO_DATABASE_URL` → `tesis_demo_db` local, PostgreSQL real, JWT y consentimiento reales de esa base, pero generador conversacional y extractor simulados. Comprueba registro/inicio de sesión, avisos demo, consentimiento, conversación y mensajes, `/signals/extract`, `/signals/results` y `preliminaryGuidance`, propiedad y bloqueo sin consentimiento. No llama a OpenAI. La suite general `npm run test:integration`, cuando se ejecuta separadamente, usa `TEST_DATABASE_URL` para `tesis_test_db`; no es la configuración de `demo:conversational`. Ningún comando usa `DATABASE_URL` como fallback.

Los avisos de `tesis_demo_db` están marcados como solo demostración y no son aprobación legal ni consentimiento apto para participantes. La demo verifica infraestructura y contratos con datos sintéticos, no aprobación clínica/profesional ni aptitud para un piloto.

La comprobación actual de avisos no pudo completarse porque el servidor local no estaba disponible. La disponibilidad de avisos en la instancia de demostración debe comprobarse con el endpoint público; no se siembran avisos ni consentimientos desde esta guía.
