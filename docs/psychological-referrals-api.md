# Psychological referrals API (synthetic test only)

These routes are mounted at `/api/v1/me/psychological-referrals`. They are unavailable unless the server is outside production, explicitly configured as `synthetic_test`, restricted to a configured account allowlist, connected to loopback `tesis_test_db`, given an explicitly allowlisted test recipient, and configured with implicit-TLS SMTP. They are not a professional referral service and are not enabled for participants.

All routes require `Authorization: Bearer <JWT>`. The client cannot choose a recipient, source signal levels, report contents, or owner ID. The only consent purpose is `psychological_referral_sharing`; when a source analysis is attached, current `conversational_signal_analysis` consent is also required. Existing conversational consent does not authorize sharing.

## Create a voluntary draft

`POST /api/v1/me/psychological-referrals`

Header: `Idempotency-Key: <UUID>`.

```json
{
  "reason": "Quiero conversar con alguien sobre cómo me estoy sintiendo.",
  "sourceAnalysisId": "01234567-89ab-4cde-8fab-0123456789ab"
}
```

Both fields are optional. Omit `sourceAnalysisId` to request support without a conversational analysis. `reason` is voluntary, limited, and rejects obvious email/phone details. Do not include third-party or highly identifying information.

`201` returns a preview; `200` means the same idempotent request already created it. The server-selected exact test recipient and `previewHash` are shown before sending:

```json
{
  "referralId": "e3b90ad0-21ed-4fcf-80b0-47c89f5cf070",
  "status": "draft",
  "recipient": "u20181g752@upc.edu.pe",
  "previewHash": "<64 lowercase hex characters>",
  "report": {
    "contractVersion": "psychological-referral-report-1.0",
    "referralId": "e3b90ad0-21ed-4fcf-80b0-47c89f5cf070",
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

With source analysis, `signals` contains only its exploratory levels, summaries, and paraphrased evidence. It never includes full messages or DASS-21. The levels are not a crisis detector. A separate urgent-support procedure must be used when needed.

## Read preview and send

`GET /api/v1/me/psychological-referrals/:id` returns the owner's current preview. Frontend must display the entire report and exact recipient, then obtain a distinct explicit confirmation.

`POST /api/v1/me/psychological-referrals/:id/send`

Header: a new UUID `Idempotency-Key`.

```json
{ "confirmed": true, "previewHash": "<the exact previewHash returned above>" }
```

The server rechecks owner, consent, source-analysis validity, recipient allowlist and preview hash before making one SMTP attempt. It does not retry. `200` reports `status: "sent"` only after SMTP acceptance. A `503` may mean delivery was uncertain; do not retry with a new key or create another request until operationally reconciled. Repeating the same key after a recorded success is idempotent and returns `duplicate: true` without another email.

`DELETE /api/v1/me/psychological-referrals/:id` cancels an unsent draft and clears its stored report. Sent records cannot be cancelled by this endpoint.

## Errors and activation

`400` invalid JSON/schema/Idempotency-Key; `401` missing/invalid JWT; `403` missing current purpose-specific consent; `404` missing owner resource or unavailable/expired source analysis; `409` invalid confirmation, incompatible state, or idempotency conflict; `503` test-only feature or mail service unavailable. Errors do not include report contents or SMTP credentials.

The purpose `psychological_referral_sharing` is a new consent purpose, but no notice is published by this change. The module therefore remains fail-closed until a reviewed notice is published and accepted. No production migration or sending is performed here. SMTP variables and account/recipient allowlists must be configured only in a verified local test setup. Do not use real participant data.

## Local synthetic-only configuration and smoke procedure

The normal server's DB client uses `DATABASE_URL`; before starting it for this feature, that process variable must point to a local `tesis_test_db` URL. The referral gate independently checks loopback and the exact database name. Configure only in the current PowerShell process (never in `.env`): `NODE_ENV=development`, `PSYCHOLOGICAL_REFERRALS_ENABLED=true`, `PSYCHOLOGICAL_REFERRALS_DEPLOYMENT=synthetic_test`, `PSYCHOLOGICAL_REFERRALS_ALLOWED_ACCOUNT_IDS=<synthetic account UUID>`, `PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENTS=u20181g752@upc.edu.pe,pieroms25@gmail.com`, `PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENT=<one exact allowlisted mailbox>`, `PSYCHOLOGICAL_REFERRAL_SMTP_HOST=<TLS SMTP host>`, `PSYCHOLOGICAL_REFERRAL_SMTP_PORT=465`, `PSYCHOLOGICAL_REFERRAL_SMTP_USERNAME`, `PSYCHOLOGICAL_REFERRAL_SMTP_PASSWORD`, and `PSYCHOLOGICAL_REFERRAL_SMTP_FROM`. Use only a synthetic account whose email ends in `@example.test`. The selected mailbox is an explicitly configured test destination, not a designation of a clinician.

After applying migration 0015 only to verified loopback `tesis_test_db`, start the API and exercise create → GET preview → manually display exact report and recipient → obtain an explicit affirmative user confirmation → send using `confirmed: true`, the displayed `previewHash`, and an `Idempotency-Key`. Automated tests use a fake mailer; this manual HTTP send can deliver to the selected mailbox and must be treated as a real email. Do not run it unless that one delivery is intended. Clear the process-only variables after stopping the test server. The application is unavailable in production even if these variables are set.

Before any non-synthetic use, responsible owners must decide and publish a retention period for referral drafts and already-sent report records, approve notice text and SMTP/data-processing terms, and authorize the recipient/service. Cancellation clears only an unsent report; it cannot recall an accepted email.

## Manual email-check command

The opt-in script is `scripts/run-synthetic-psychological-referral-email-check.ts`; it starts only an ephemeral loopback Express router with one newly created synthetic account. It writes a synthetic conversation/message, records a referral-sharing consent against a recognized synthetic notice, creates a no-analysis report, then exercises create and preview over HTTP. It never uses `DATABASE_URL`, OpenAI, DASS-21, recommendations, or the main application composition.

PowerShell preflight without database writes or SMTP activity:

```powershell
npm run referrals:check:synthetic-email -- --preflight
```

Preparation only, with cleanup and zero email attempts:

```powershell
npm run referrals:check:synthetic-email -- --run-synthetic-psychological-referral-email-check --confirm-synthetic-only
```

One real attempt requires both additional flags and an interactive exact phrase after the script has fetched and structurally checked the preview and shown the destination. It does not print report content:

```powershell
npm run referrals:check:synthetic-email -- --run-synthetic-psychological-referral-email-check --confirm-synthetic-only --send-one-real-email --confirm-recipient=u20181g752@upc.edu.pe
```

Replace the confirmation recipient only with the selected mailbox already present in `PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENTS`. Required process variables are `TEST_DATABASE_URL` (loopback, exact `tesis_test_db`), `PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENTS`, `PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENT`, `PSYCHOLOGICAL_REFERRAL_SMTP_HOST`, `PSYCHOLOGICAL_REFERRAL_SMTP_USERNAME`, `PSYCHOLOGICAL_REFERRAL_SMTP_PASSWORD`, and `PSYCHOLOGICAL_REFERRAL_SMTP_FROM`; SMTP port is fixed to 465. No values are printed. In the send mode the script rechecks live database identity and recipient allowlist immediately before the one HTTP send request; it does not retry an ambiguous result. It removes the exact synthetic account and any synthetic notice it created. An already existing recognized test notice is left intact. Output includes only phase, duration, attempt counts, SMTP stage/code when available, safe error category, uncertainty of acceptance, and cleanup status. It omits SMTP response text, report content, and credentials; the HTTP error remains generic. Never run the send mode unless delivery of one synthetic email is intended.
