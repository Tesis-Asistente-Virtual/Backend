# Sprint 5A.1 — Disponibilidad de consentimiento para la demo

## Estado

**Implementado:** Consent & Privacy y las restricciones PostgreSQL ya reconocen cuatro finalidades independientes. Los contratos actuales son `GET /api/v1/consents/notices`, `GET /api/v1/consents/me` y `POST /api/v1/consents/me/decisions`. La lista de avisos muestra solo versiones publicadas y efectivas. El endpoint de decisiones usa JWT, toma `accountId` de la identidad autenticada y acepta un body estricto sin `accountId`.

**Preparado en código, no cargado:** el seeder local para `tesis_demo_db` ahora tiene fixtures sintéticos de las cuatro finalidades. En esta tarea no se ejecutó el seeder ni se consultó/escribió ninguna base; la disponibilidad real en `tesis_demo_db` queda pendiente de una ejecución manual posterior con `DEMO_DATABASE_URL` validada.

**No es aprobación:** los textos agregados contienen `SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS`. No son avisos jurídicos, no autorizan tratamiento con estudiantes reales y no crean aprobación ética o profesional.

## Finalidades y versiones de demo

| Finalidad | Versión fixture | Requisito de uso actual |
| --- | --- | --- |
| `ai_conversation_processing` | `demo-4c3-ai-v1` (existente, contenido intacto) | Consentimiento vigente antes de persistir un mensaje nuevo o transferirlo al proveedor por Conversations REST/SSE. |
| `structured_signal_extraction` | `demo-4c3-signals-v1` (existente, contenido intacto) | Consentimiento independiente; extracción solo explícita y junto con `ai_conversation_processing`. |
| `preliminary_assessment` | `demo-5a1-assessment-v1` (nuevo fixture) | Consentimiento específico para iniciar, reanudar, responder y completar las operaciones protegidas. No hay instrumento clínico aprobado habilitado. |
| `longitudinal_monitoring` | `demo-5a1-monitoring-v1` (nuevo fixture) | Consentimiento específico para inscripción, reanudación y creación explícita de sesiones. No hay mediciones o seguimiento de síntomas automático. |

Las versiones de conversación y extracción no se alteraron. Sus textos heredados mencionan que el fixture es solo para `tesis_test_db`, aunque la configuración actual los reutiliza en la demo aislada `tesis_demo_db`; se conservan por la inmutabilidad y deben tratarse como fixtures técnicos, no como avisos para presentar fuera del entorno de desarrollo. Cualquier cambio requeriría una nueva versión tras revisión, nunca editar las versiones publicadas. El índice parcial permite un aviso publicado por finalidad; el aviso publicado es inmutable. Si el seeder encuentra contenido, versión, hash, estado o vigencia incompatible, aborta la transacción sin sustituirlo. No se deben copiar fixtures de demo a `tesis_db` ni usar como autorización para estudiantes.

## Contratos HTTP reales

### `GET /api/v1/consents/notices`

No exige JWT. Responde `200` con un arreglo de avisos disponibles:

```json
[
  {
    "id": "uuid-del-aviso",
    "purpose": "preliminary_assessment",
    "version": "demo-5a1-assessment-v1",
    "content": "Texto sintético etiquetado como demostración...",
    "effectiveAt": "2026-11-22T12:00:00.000Z"
  }
]
```

En la demo, el frontend puede mostrar `content` para cada finalidad publicada. No debe tratar la existencia del aviso como aceptación.

### `GET /api/v1/consents/me`

Requiere `Authorization: Bearer <JWT>`. `accountId` se obtiene de JWT. Responde:

```json
{
  "items": [
    {
      "purpose": "longitudinal_monitoring",
      "state": "not_decided",
      "currentNoticeVersion": "demo-5a1-monitoring-v1",
      "changedAt": null
    }
  ]
}
```

Los estados disponibles son `granted`, `declined`, `withdrawn`, `not_decided` y `renewal_required`. La versión mostrada es la versión publicada vigente para esa finalidad, no una autorización.

### `POST /api/v1/consents/me/decisions`

Requiere JWT y acepta únicamente este objeto estricto (`201` al registrar):

```json
{
  "purpose": "preliminary_assessment",
  "noticeVersionId": "uuid-del-aviso-publicado-y-vigente",
  "action": "granted",
  "idempotencyKey": "uuid-nuevo-para-esta-operacion"
}
```

`action` admite `granted`, `declined` o `withdrawn`. Para rechazar o retirar se conserva la finalidad y el ID del aviso vigente. La repetición de una clave con payload idéntico es idempotente; reutilizarla con otra decisión genera conflicto. No se acepta `accountId` en el body; Zod estricto lo rechaza y el controller usa la cuenta autenticada.

La decisión se asocia a una versión publicada y efectiva de la misma finalidad. El repositorio serializa decisiones bajo bloqueo de cuenta y bloqueo compartido del aviso; la escritura no crea ni publica avisos.

## Estados, retiro y flujos

- Una concesión para una finalidad no concede ninguna otra.
- La decisión vigente debe ser `granted` para el aviso actualmente publicado y efectivo.
- `declined` y `withdrawn` deniegan; un aviso sustituido convierte una concesión antigua en `renewal_required`.
- Sin aviso vigente no hay una concesión utilizable. El flujo protegido falla cerrado.
- Conversations requiere `ai_conversation_processing`; la extracción explícita requiere además `structured_signal_extraction`.
- PreliminaryAssessment y LongitudinalMonitoring requieren sus finalidades propias y mantienen revalidación transaccional en escrituras protegidas.
- Retirar bloquea operaciones futuras cubiertas; no borra por sí mismo respuestas, evaluaciones, inscripciones ni eventos históricos.

## Procedimiento seguro pendiente de ejecutar por el operador

La URL solo debe existir en la sesión local y apuntar a `tesis_demo_db` en loopback:

```powershell
npm run demo:verify-db
npm run demo:seed-consent
npm run demo:conversational
```

El primer comando es de solo lectura. `demo:seed-consent` escribe fixtures y debe ejecutarse únicamente tras verificar el destino. `demo:conversational` usa PostgreSQL real y proveedores simulados; no llama a OpenAI. Esta tarea no ejecutó ninguno de ellos. No usar `TEST_DATABASE_URL`, `DATABASE_URL`, `tesis_test_db` ni `tesis_db` para la carga.

## Pendientes

- Revisión jurídica y ética del aviso real, la finalidad, el consentimiento y el tratamiento de datos sensibles.
- Confirmación profesional de alcance, versión, vigencia, lenguaje y material informativo antes de cualquier prueba con estudiantes.
- Verificar manualmente las cuatro entradas en `GET /consents/notices` solo después de la carga aislada.
- Definir pruebas HTTP/PostgreSQL de las finalidades nuevas sobre un entorno autorizado, si se requiere validar su persistencia.
- La disponibilidad de aviso sintético no habilita instrumentos, mediciones, extracción automática, monitoreo de síntomas ni Safety.
