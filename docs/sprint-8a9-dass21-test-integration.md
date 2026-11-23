# Sprint 8A.9 — Estado de integración técnica DASS-21

## Diagnóstico inicial de 8A.9 (histórico)

Este diagnóstico describió el estado antes de 8A.9B. La integración de captura y finalización quedó habilitada después mediante una composición técnica separada; el scoring y la publicación de resultados siguen pendientes.

La conformidad verbal comunicada del asesor y del psicólogo se registra únicamente como contexto del proyecto. No es aprobación profesional, institucional, ética ni autorización para participantes.

## Comportamiento real encontrado

| Etapa | Comportamiento actual | Consecuencia |
|---|---|---|
| Catálogo y formulario | `isInstrumentAvailable` y `DrizzleInstrumentCatalog` solo exponen versiones `approved`, con aprobación y licencia válidas. `GetAssessmentInfo`, inicio, formulario, respuestas y finalización usan ese catálogo. | `dass21-spanish-candidate-1.1` permanece `not_approved` / `not_available` y no puede aparecer en el formulario normal. |
| Captura | `POST /api/v1/preliminary-assessments/:id/responses` acepta la respuesta estructurada existente; `optionId` se resuelve desde las opciones del instrumento y el cliente no establece `scoringValue`. | La captura puede reutilizarse una vez que exista una composición de prueba que entregue una versión técnica habilitada sin alterar el estado de aprobación de la candidata. |
| Finalización | `POST /api/v1/preliminary-assessments/:id/complete` finaliza con las reglas existentes y guarda el `AssessmentResult` histórico no disponible. No invoca `ScoreCompletedDass21Assessment`. | Completar una evaluación no calcula ni persiste automáticamente el score DASS-21. |
| Scoring interno | `ScoreCompletedDass21Assessment` es un servicio interno no compuesto en REST. Exige una versión disponible y mapeo congelado, además de consentimiento vigente. | No existe hoy un flujo HTTP que conecte finalización con scoring. |
| Lectura interna | `GetMyInternalDass21Result` verifica propiedad, consentimiento, estado, respuestas, instrumento, score y mapeo en la unidad transaccional. Exige un proveedor de soporte aprobado; el proveedor por defecto deniega. | No se puede construir una respuesta disponible con el proveedor predeterminado ni usando la candidata pendiente. |
| `GET .../:id/result` | La ruta actual ejecuta `GetMyAssessmentResult` y devuelve el contrato histórico `AssessmentResult`; no consulta scores ni llama al transformador `toDass21ParticipantResult`. | La ruta permanece score-free. No existe un endpoint de resultados DASS-21 utilizable por frontend, ni siquiera en el entorno de prueba actual. |
| OpenAPI | `Dass21ParticipantResultFuture` está documentado como componente futuro no conectado a la operación. | OpenAPI no anuncia scores como respuesta actual. |

## Datos y aislamiento (ejecución original de 8A.9)

`TEST_DATABASE_URL` no está configurada en el entorno de esta ejecución. Por tanto, no se abrió ninguna conexión PostgreSQL, no se insertaron fixtures y no se ejecutó ninguna suite de integración. No se consultó `DATABASE_URL`, `tesis_demo_db` ni otra base como alternativa.

No se modificaron instrumentos, avisos, migraciones, cuentas, consentimiento ni código productivo. La candidata española y el estado `not_approved` quedan intactos.

## Estado posterior: Sprint 8A.9B

Se implementó una composición que preserva la candidata como borrador y limita su disponibilidad al servidor técnico:

- La regla de disponibilidad técnica acepta solo la versión candidata exacta en estado draft, con aprobación pendiente y licencia sin revisar; el catálogo normal mantiene `approved`.
- El cargador idempotente solo opera tras validar `TEST_DATABASE_URL` y rechaza conflictos sin sobrescribir.
- `scripts/start-dass21-technical-test.ts` monta la composición en un servidor separado de loopback, conectado únicamente por el helper de `TEST_DATABASE_URL`. No se monta en la app normal.
- Las rutas existentes reutilizan consentimiento, JWT, ownership, captura y finalización. El scoring permanece desconectado.
- `GET /result` conserva el contrato histórico score-free; no se creó ruta duplicada.
- La integración PostgreSQL nueva requiere ejecución local porque en el entorno de trabajo no está definida `TEST_DATABASE_URL`.

## Contratos disponibles hoy

En la aplicación técnica local se pueden consumir las rutas existentes documentadas en `docs/sprint-8a9b-dass21-technical-test.md`. Fuera de ese proceso, frontend solo puede consumir los instrumentos aprobados del catálogo normal. `GET /api/v1/preliminary-assessments/:id/result` no devuelve scores ni categorías en ninguna composición de 8A.9B.

## Verificación pendiente en 8A.9

Cuando el modo técnico aislado esté implementado y haya una base autorizada disponible, ejecutar:

```powershell
npm run typecheck
npm run build
npm test
npx vitest run tests/integration/dass21-test-e2e.integration.test.ts
```

La integración debe fallar cerrada si `TEST_DATABASE_URL` falta, no es PostgreSQL local o no apunta exactamente a `tesis_test_db`. No usar `DATABASE_URL` como fallback. No ejecutar migraciones automáticamente.

## Estado de aprobación y uso

- Fuente cotejada documentalmente: según expediente 8A.7 existente.
- Aprobación profesional o institucional: no documentada; pendiente.
- Habilitación técnica de la candidata: no implementada.
- Publicación de scores/categorías a participantes: bloqueada.
- Uso con estudiantes o respuestas reales: no autorizado por este incremento.
