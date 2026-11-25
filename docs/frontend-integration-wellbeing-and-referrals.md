# Integración frontend: recomendaciones y solicitudes de orientación

Guía basada en los routers, controladores, esquemas Zod, servicios y políticas actualmente montados en `src/app.ts`. Los ejemplos de respuestas son sintéticos y muestran la forma del contrato; no representan resultados de una persona.

## 1. Propósito y disponibilidad

Los análisis conversacionales son evidencia textual exploratoria persistida. No son diagnósticos, gravedad clínica ni detector de crisis. Las recomendaciones son orientación general o sugerencias vinculadas a evidencia existente; no son tratamiento ni consejo clínico. La derivación es una solicitud voluntaria: el servidor prepara un borrador y solo intenta compartirlo después de una confirmación explícita del estudiante.

Estos dos módulos consumen análisis conversacionales persistidos. No vuelven a leer mensajes ni calculan DASS-21. Los módulos están registrados en la composición normal de Express, pero eso no significa que estén habilitados para cuentas reales: las recomendaciones requieren política de piloto y consentimientos; las derivaciones están restringidas actualmente a una composición de prueba sintética, no disponible en producción.

## 2. Autenticación y formato común

Reemplace `<API_BASE_URL>` por la URL del entorno que el responsable backend haya autorizado. El repositorio no define aquí una URL pública de piloto.

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

Los recursos se asocian a la identidad del JWT; no envíe `accountId` ni identidad del propietario en el body. Las solicitudes protegidas sin token válido responden `401` con `{"error":"Unauthorized"}`. Los cuerpos inválidos o con propiedades adicionales responden `400` con `{"error":"Invalid request data"}`. Para errores de los módulos, el contrato HTTP es un objeto `{ "error": "..." }`; el backend no entrega códigos de error propios en el JSON.

Ejemplos de errores exactos comunes:

```json
{ "error": "Current recommendations consent is required" }
```

```json
{ "error": "Source analysis is unavailable" }
```

```json
{ "error": "Recommendations are temporarily unavailable" }
```

```json
{ "error": "Current psychological referral consent is required" }
```

```json
{ "error": "Psychological referral or source analysis was not found" }
```

```json
{ "error": "Explicit confirmation does not match the current preview" }
```

```json
{ "error": "Referral email delivery could not be confirmed" }
```

`Idempotency-Key` es obligatorio en creación de borrador y envío de derivación. Su valor debe ser un UUID nuevo para cada intención de operación. En recomendaciones no se usa esta cabecera.

## 3. Consentimiento previo

Los avisos disponibles se consultan en `GET /api/v1/consents/notices` (sin JWT en el router actual). La respuesta es un arreglo de `{ id, purpose, version, content, effectiveAt }`. Para consultar el estado propio use `GET /api/v1/consents/me` con JWT; devuelve `{ "items": [...] }` con estados por finalidad.

Una decisión se registra con `POST /api/v1/consents/me/decisions`, JWT y este body estricto:

```json
{
  "purpose": "wellbeing_recommendations",
  "noticeVersionId": "550e8400-e29b-41d4-a716-446655440010",
  "action": "granted",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440011"
}
```

Valores válidos de `action`: `granted`, `declined`, `withdrawn`. La respuesta `201` contiene `{ id, purpose, noticeVersionId, action, createdAt }`. Use el `id` y `purpose` exactos devueltos por los avisos vigentes; no fabrique IDs ni presuponga que existe un aviso publicado. Errores relevantes: `400` entrada inválida, `401` no autenticado, `404` aviso no disponible, `409` clave de idempotencia reutilizada con otra decisión.

Para generar recomendaciones se exige una concesión vigente y correspondiente al aviso publicado actual para cada propósito: `ai_conversation_processing`, `structured_signal_extraction`, `conversational_signal_analysis` y `wellbeing_recommendations`. Para una derivación sin análisis adjunto se exige `psychological_referral_sharing`; si se adjunta un análisis, también `conversational_signal_analysis` vigente.

## 4. Recomendaciones de bienestar

Montaje: `/api/v1/me/recommendations`.

### `POST /api/v1/me/recommendations/generate`

Requiere JWT y `Content-Type: application/json`. Body estricto, ambas propiedades opcionales:

```json
{}
```

o bien:

```json
{ "analysisId": "550e8400-e29b-41d4-a716-446655440010" }
```

`analysisId`, si se incluye, debe ser UUID de un análisis propio todavía vigente. El cliente no puede enviar niveles, evidencias, justificaciones ni contenido de recomendaciones.

Una creación devuelve `201`; si ya hay un conjunto para ese análisis devuelve `200` con el mismo conjunto. Mientras otra generación está reservada, devuelve `409`. Ejemplo de respuesta exitosa sintética (los textos generados pueden variar):

```json
{
  "contractVersion": "wellbeing-recommendations-1.0",
  "recommendationSetId": "550e8400-e29b-41d4-a716-446655440020",
  "status": "available",
  "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
  "generatedAt": "2026-11-24T12:00:00.000Z",
  "expiresAt": "2027-02-22T12:00:00.000Z",
  "recommendations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440021",
      "kind": "evidence_based",
      "title": "Divide una tarea en pasos",
      "description": "Elige una parte pequeña de una actividad y decide cuándo te gustaría empezarla.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440022",
      "kind": "evidence_based",
      "title": "Reserva un momento breve",
      "description": "Si te resulta útil, reserva unos minutos para organizar lo que te gustaría atender primero.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440023",
      "kind": "evidence_based",
      "title": "Considera conversar con alguien",
      "description": "Puedes compartir con alguien de confianza qué parte de la situación te gustaría ordenar.",
      "dimension": "anxiety",
      "justification": "Se vincula con evidencia exploratoria de anxiety registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.",
      "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010",
      "evidenceReferences": [{ "dimension": "anxiety", "evidenceIndex": 0 }]
    }
  ],
  "professionalSupportNotice": null,
  "isDiagnostic": false,
  "isClinicalAdvice": false,
  "limitations": [
    "exploratory_conversational_evidence_only",
    "not_a_diagnosis_or_clinical_assessment",
    "not_a_crisis_detector",
    "not_a_substitute_for_professional_care",
    "generated_from_persisted_analysis_not_messages"
  ]
}
```

Each card has `kind` `evidence_based` or `general`; `dimension` is `depression`, `anxiety`, `stress`, or `null`. `evidenceReferences` contains `{ dimension, evidenceIndex }` indexes into persisted source evidence, not message IDs. The set contains 3–5 cards.

Dimensions at `low` or `moderate` may be used as input for evidence-based cards. `high` is not used to personalize self-help; it may cause the optional `professionalSupportNotice` text. If there are no `low`/`moderate` dimensions (including all `insufficient_evidence`), the server creates three `general` cards, with null dimension and empty evidence references; this path does not call OpenAI and does not claim findings. `high` is not an emergency signal and never sends a referral.

Relevant errors: `400` invalid body/UUID/extra property; `401` token invalid; `403` a current required consent is absent; `404` no owned, unexpired source analysis; `409` generation already in progress or persistence conflict; `502` invalid provider output; `503` policy disabled or provider unavailable. Error JSON is `{ "error": "..." }`.

### `GET /api/v1/me/recommendations/latest`

Requires JWT. A current set returns the same `RecommendationSet` shape above. If there is no current set, returns HTTP `200`:

```json
{ "status": "not_available", "reason": "no_current_recommendations", "isDiagnostic": false }
```

The schema also permits `reason: "feature_disabled"`, but the current service does not return that variant: disabled policy raises HTTP `503`. Missing/replaced consent raises `403`. Expired sets are not returned; they are removed for that account as part of the repository read. Recommendation expiry follows the source analysis expiry. The client should not infer an expiration payload from a `404` or `503`.

## 5. Derivación psicológica voluntaria

Montaje: `/api/v1/me/psychological-referrals`. No existe en este módulo un endpoint de listado ni historial.

### Crear borrador — `POST /api/v1/me/psychological-referrals`

Requiere JWT, JSON y `Idempotency-Key: <UUID>`. Body estricto; ambos campos son opcionales:

```json
{
  "reason": "Quiero conversar con alguien sobre cómo me estoy sintiendo.",
  "sourceAnalysisId": "550e8400-e29b-41d4-a716-446655440010"
}
```

`reason` se recorta y limita a 1–1200 caracteres si se proporciona; no puede contener controles, emails o teléfonos reconocibles. `sourceAnalysisId` debe ser UUID de análisis propio y no vencido. Omitirlo crea una solicitud sin análisis adjunto. El módulo actual además limita el propietario a cuenta sintética cuyo email termina en `@example.test`.

Respuesta `201` para nuevo borrador o `200` para repetición idempotente del mismo intento. Es directamente un `ReferralPreview`:

```json
{
  "referralId": "550e8400-e29b-41d4-a716-446655440030",
  "status": "draft",
  "recipient": "test-inbox@example.test",
  "previewHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "report": {
    "contractVersion": "psychological-referral-report-1.0",
    "referralId": "550e8400-e29b-41d4-a716-446655440030",
    "createdAt": "2026-11-24T12:00:00.000Z",
    "reason": "Quiero conversar con alguien sobre cómo me estoy sintiendo.",
    "sourceAnalysisId": null,
    "analysisVersion": null,
    "analysisAnalyzedAt": null,
    "overallSummary": null,
    "findingsAvailability": "no_analysis_attached",
    "signals": null,
    "absenceOfFindings": true,
    "isDiagnostic": false,
    "limitations": [
      "exploratory_textual_evidence_only",
      "levels_are_not_clinical_severity_or_risk",
      "not_a_diagnosis_or_clinical_assessment",
      "not_a_crisis_detector_or_safety_assessment",
      "no_full_messages_or_dass21_data_included"
    ]
  },
  "createdAt": "2026-11-24T12:00:00.000Z",
  "sentAt": null,
  "deliveryReference": null,
  "isDiagnostic": false
}
```

`recipient` y `previewHash` dependen de la configuración del servidor; el ejemplo usa un buzón reservado ficticio y un hash de ejemplo, no un valor utilizable. Con análisis adjunto, `signals` contiene exactamente las dimensiones `depression`, `anxiety`, `stress`, cada una con `{ level, summary, evidence }`; `level` es exploratorio y `evidence` contiene paráfrasis. El reporte no incluye mensajes completos, terceros ni DASS-21.

### Obtener vista previa — `GET /api/v1/me/psychological-referrals/:id`

Requiere JWT; `:id` es el UUID `referralId`. Devuelve HTTP `200` y el `ReferralPreview` actual. Si está en `draft`, muestra reporte, destinatario y `previewHash`. La pantalla debe mostrar el reporte y el destinatario exactos antes de pedir confirmación. La vista previa por sí sola no autoriza compartir.

### Confirmar y enviar — `POST /api/v1/me/psychological-referrals/:id/send`

Requiere JWT, `Idempotency-Key: <UUID>` y body estricto:

```json
{
  "confirmed": true,
  "previewHash": "<previewHash exacto recibido en la vista previa>"
}
```

La respuesta HTTP `200` es el objeto `ReferralPreview` plano más `duplicate` booleano. Envío recién aceptado por el adaptador: `status: "sent"`, `duplicate: false`. Repetición de una operación ya registrada con la misma clave/hash/destinatario: `duplicate: true`, sin un nuevo correo. `sentAt` y `deliveryReference` se completan según la aceptación SMTP; no exponga delivery reference como contenido del reporte.

Ejemplo de forma, con payload abreviado solo para no repetir los mismos campos del reporte:

```json
{
  "referralId": "550e8400-e29b-41d4-a716-446655440030",
  "status": "sent",
  "recipient": "test-inbox@example.test",
  "previewHash": null,
  "report": { "contractVersion": "psychological-referral-report-1.0", "referralId": "550e8400-e29b-41d4-a716-446655440030", "createdAt": "2026-11-24T12:00:00.000Z", "reason": null, "sourceAnalysisId": null, "analysisVersion": null, "analysisAnalyzedAt": null, "overallSummary": null, "findingsAvailability": "no_analysis_attached", "signals": null, "absenceOfFindings": true, "isDiagnostic": false, "limitations": ["exploratory_textual_evidence_only", "levels_are_not_clinical_severity_or_risk", "not_a_diagnosis_or_clinical_assessment", "not_a_crisis_detector_or_safety_assessment", "no_full_messages_or_dass21_data_included"] },
  "createdAt": "2026-11-24T12:00:00.000Z",
  "sentAt": "2026-11-24T12:01:00.000Z",
  "deliveryReference": "provider-reference",
  "isDiagnostic": false,
  "duplicate": false
}
```

No reintento automático. Un `503` de entrega puede representar `failed` o `delivery_unknown`; si el resultado es incierto, no vuelvas a enviar con otra clave ni crees otro borrador hasta una conciliación operativa. La respuesta de error no revela el detalle SMTP.

### Cancelar borrador — `DELETE /api/v1/me/psychological-referrals/:id`

Requiere JWT; no lleva body. Solo cancela si el recurso pertenece a la cuenta autenticada y sigue en `draft`. Respuesta `200`:

```json
{ "referralId": "550e8400-e29b-41d4-a716-446655440030", "status": "cancelled" }
```

Al cancelar se limpian el reporte, razón, análisis adjunto y hash. No revoca un email aceptado. Si no existe un borrador cancelable responde `404`.

### Estados y errores de derivación

Estados reales del recurso: `draft`, `sending`, `sent`, `failed`, `delivery_unknown`, `cancelled`. `loading`, `sending` como animación UI, `consent_required` y `expired` no son payloads de estado de este contrato; el consentimiento faltante es HTTP `403`, y el análisis fuente vencido/no disponible es HTTP `404`.

Errores relevantes: `400` body, UUID o clave inválidos; `401` JWT ausente/inválido; `403` consentimiento vigente requerido; `404` recurso propio o análisis fuente no disponible; `409` hash/confirmación incorrectos, estado incompatible o conflicto de idempotencia; `503` módulo/proveedor no disponible o entrega no confirmada. Siempre `{ "error": "..." }`.

## 6. Flujos sugeridos para UI

**Recomendaciones:** análisis conversacional visible → botón voluntario → `POST generate` → loading de UI → renderizar `recommendations` como tarjetas → en visitas posteriores consultar `GET latest`. Si `not_available`, presentar estado vacío; no inventar tarjetas en cliente.

**Derivación voluntaria:** botón “Solicitar apoyo psicológico” → `POST` borrador (clave UUID) → `GET :id` para refrescar preview → mostrar reporte y destinatario exactos → confirmación afirmativa explícita → `POST :id/send` con una nueva clave UUID, `confirmed: true` y hash exacto → mostrar estado devuelto. Permitir cancelar mientras sea borrador.

**Invitación asociada a `high`:** si el análisis que ya recibió el frontend tiene una dimensión `high`, se puede destacar una invitación opcional a solicitar apoyo. `high` no indica crisis ni gravedad clínica. No enviar automáticamente ni impedir que el usuario decline. La derivación es voluntaria con cualquier nivel y puede solicitarse sin análisis adjunto.

Estados de UI como `loading`, `success`, `empty` o `failed` son representación del cliente. El backend de recomendaciones expone `available` y `not_available`; el recurso de derivación usa los estados enumerados arriba. No mapear un HTTP `403`/`503` como un objeto `not_available`.

## 7. Tipos TypeScript compatibles

```ts
export type Dimension = 'depression' | 'anxiety' | 'stress';
export type EvidenceLevel = 'low' | 'moderate' | 'high' | 'insufficient_evidence';

export interface Recommendation {
  id: string;
  kind: 'evidence_based' | 'general';
  title: string;
  description: string;
  dimension: Dimension | null;
  justification: string;
  sourceAnalysisId: string;
  evidenceReferences: Array<{ dimension: Dimension; evidenceIndex: number }>;
}

export interface RecommendationSet {
  contractVersion: 'wellbeing-recommendations-1.0';
  recommendationSetId: string;
  status: 'available';
  sourceAnalysisId: string;
  generatedAt: string;
  expiresAt: string;
  recommendations: Recommendation[];
  professionalSupportNotice: string | null;
  isDiagnostic: false;
  isClinicalAdvice: false;
  limitations: [
    'exploratory_conversational_evidence_only',
    'not_a_diagnosis_or_clinical_assessment',
    'not_a_crisis_detector',
    'not_a_substitute_for_professional_care',
    'generated_from_persisted_analysis_not_messages'
  ];
}

export interface RecommendationUnavailable {
  status: 'not_available';
  reason: 'no_current_recommendations' | 'feature_disabled';
  isDiagnostic: false;
}

export interface ReferralReportSignal {
  level: EvidenceLevel;
  summary: string;
  evidence: string[];
}

export interface ReferralReport {
  contractVersion: 'psychological-referral-report-1.0';
  referralId: string;
  createdAt: string;
  reason: string | null;
  sourceAnalysisId: string | null;
  analysisVersion: string | null;
  analysisAnalyzedAt: string | null;
  overallSummary: string | null;
  findingsAvailability: 'included' | 'no_analysis_attached';
  signals: Record<Dimension, ReferralReportSignal> | null;
  absenceOfFindings: boolean;
  isDiagnostic: false;
  limitations: [
    'exploratory_textual_evidence_only',
    'levels_are_not_clinical_severity_or_risk',
    'not_a_diagnosis_or_clinical_assessment',
    'not_a_crisis_detector_or_safety_assessment',
    'no_full_messages_or_dass21_data_included'
  ];
}

export type ReferralStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'delivery_unknown' | 'cancelled';

export interface ReferralDraft {
  referralId: string;
  status: ReferralStatus;
  recipient: string | null;
  previewHash: string | null;
  report: ReferralReport | null;
  createdAt: string;
  sentAt: string | null;
  deliveryReference: string | null;
  isDiagnostic: false;
}

export type ReferralPreview = ReferralDraft;
export type ReferralSendResult = ReferralDraft & { duplicate: boolean };
export interface APIError { error: string; }
```

La estructura `ReferralDraft` no implica que todo estado tenga reporte: por ejemplo, en `cancelled` `recipient`, `previewHash` y `report` son `null`. Los tipos de API no expresan validaciones cruzadas Zod; respetar siempre las respuestas recibidas.

## 8. Ejemplos `fetch`

```ts
const apiBase = '<API_BASE_URL>';
const token = '<JWT ficticio>';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// Generar o recuperar recomendaciones del análisis vigente más reciente.
const generated = await fetch(`${apiBase}/api/v1/me/recommendations/generate`, {
  method: 'POST', headers, body: JSON.stringify({}),
});

// Consultar el conjunto vigente.
const latest = await fetch(`${apiBase}/api/v1/me/recommendations/latest`, { headers });

// Crear derivación voluntaria sin adjuntar análisis.
const draftResponse = await fetch(`${apiBase}/api/v1/me/psychological-referrals`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ reason: 'Quiero solicitar orientación.' }),
});
const draft = await draftResponse.json() as ReferralDraft;

// Recuperar preview antes de presentarlo y solicitar confirmación en UI.
const previewResponse = await fetch(`${apiBase}/api/v1/me/psychological-referrals/${draft.referralId}`, { headers });
const preview = await previewResponse.json() as ReferralPreview;

// Ejecutar solo tras acción afirmativa explícita del usuario,
// mostrando el destinatario y contenido de preview.
const sendResponse = await fetch(`${apiBase}/api/v1/me/psychological-referrals/${draft.referralId}/send`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ confirmed: true, previewHash: preview.previewHash }),
});

// Cancelar solo un borrador aún no enviado.
const cancelResponse = await fetch(`${apiBase}/api/v1/me/psychological-referrals/${draft.referralId}`, {
  method: 'DELETE', headers,
});
```

En código real, compruebe `response.ok` antes de interpretar el body y trate el error como `{ error: string }`. No iniciar `send` automáticamente, ni desde render, ni ante `high`.

## 9. Privacidad y seguridad

- OpenAI y SMTP son responsabilidades del backend. Nunca se entregan credenciales al frontend.
- No almacene reporte, evidencia ni respuesta sensible en `localStorage`; manténgalos en memoria el tiempo necesario y evite registrar bodies/respuestas.
- Una preview no autoriza un envío. La persona debe ver el destinatario exacto y confirmar explícitamente.
- No incluya mensajes completos, información de terceros, DASS-21 ni campos que el backend no provee.
- Los consentimientos deben consultarse y registrarse con sus rutas oficiales; el consentimiento conversacional no equivale a consentimiento para compartir un reporte.

## 10. Restricciones actuales de activación

**Recomendaciones:** exige `WELLBEING_RECOMMENDATIONS_ENABLED=true`, `WELLBEING_RECOMMENDATIONS_DEPLOYMENT=authorized_pilot`, `WELLBEING_RECOMMENDATIONS_ALLOWED_ACCOUNT_IDS` con la cuenta permitida, proveedor OpenAI configurado cuando haya dimensiones elegibles, y los cuatro avisos/consentimientos vigentes. La ausencia de habilitación resulta en `503`; no hay permiso que el cliente pueda solicitar en un header.

**Derivaciones:** aunque las rutas aparecen en el router normal, su configuración actual solo permite un entorno fuera de `production`, deployment `synthetic_test`, base local exacta `tesis_test_db`, cuenta en allowlist, destinatario de prueba configurado y permitido, y SMTP disponible. La persistencia requiere además una cuenta `@example.test`. Esto no es una derivación profesional ni está habilitado para participantes reales. No use una URL de prueba de correo como autorización de piloto.

El backend está técnicamente probado según el estado comunicado por el equipo, pero la presencia del código y tests no acredita habilitación global ni autorización para personas reales. Las cuentas, consentimientos, avisos y variables efectivos dependen del entorno desplegado y no se deben inferir desde el frontend.

## 11. Discrepancias verificadas y límites

1. `latestRecommendationsResponseSchema` permite el valor `reason: "feature_disabled"`, pero `RecommendationService.latest()` actualmente devuelve `503` cuando la feature está deshabilitada; la única respuesta `not_available` generada en el flujo actual usa `no_current_recommendations`.
2. El servicio de cancelación de derivaciones llama directamente a `cancelDraft`: a diferencia de create/get/send, no ejecuta `assertEnabled` ni vuelve a comprobar consentimiento. El router sí exige JWT y la actualización solo afecta al `referralId` del propietario y estado `draft`. No asuma que cancelar produce `503` si la función está deshabilitada.
3. Los esquemas y rutas establecen que el body de generación de recomendaciones es un objeto JSON; envíe `{}` si no selecciona un `analysisId`, no omita el body.
4. La cancelación devuelve el objeto pequeño `{ referralId, status }`, no la preview completa.

No se alteró código para resolver estas diferencias; esta guía refleja el comportamiento observado.

## 12. Checklist de integración

- [ ] Obtener URL y ambiente autorizados del responsable backend.
- [ ] Usar JWT solo en memoria segura y manejar `401` mediante reautenticación.
- [ ] Consultar avisos y estado; aceptar solo aviso vigente y registrar decisiones con UUID de idempotencia.
- [ ] Manejar `403`, `404`, `409`, `502` y `503` como errores HTTP, no como estados de éxito.
- [ ] Renderizar únicamente campos devueltos; distinguir cards generales y evidencia exploratoria.
- [ ] Probar ausencia/análisis vencido, falta de consentimiento y feature deshabilitada.
- [ ] Antes del envío, mostrar reporte y destinatario exactos y requerir acción afirmativa.
- [ ] Evitar reenvíos automáticos cuando `delivery_unknown` o error `503`.
- [ ] Probar cancelación de un borrador y acceso de otra cuenta.
- [ ] Confirmar con backend la habilitación efectiva del entorno; no asumir acceso real por el contrato documentado.
