# Sprint 8A.4 — preparación interna del resultado DASS-21

## Estado y alcance

Se preparó un DTO interno versionado y un query service que reúne el score ya persistido y la categorización convencional. No se añadió endpoint ni se modificó el controller, transformer, contrato OpenAPI o lógica de `GET /api/v1/preliminary-assessments/:id/result`. La ruta pública sigue respondiendo el contrato existente con `not_available`, sin puntajes ni categorías.

El servicio interno no se registra en composición REST, jobs, finalización ni frontend. El proveedor predeterminado de soporte interpretativo devuelve `null`, por lo que el resultado real permanece `not_available` hasta que exista aprobación documentada ligada a una versión concreta.

## DTO interno

`dass21-internal-result-1.0` es una unión Zod estricta:

### Disponible

```json
{
  "schemaVersion": "1.0",
  "resultVersion": "dass21-internal-result-1.0",
  "status": "available",
  "assessmentId": "<uuid-sintético>",
  "instrument": {
    "code": "DASS-21",
    "instrumentId": "<uuid-sintético>",
    "instrumentVersionId": "<uuid-sintético>",
    "version": "synthetic-version"
  },
  "scoringVersion": "dass21-score-1.0",
  "interpretationVersion": "dass21-conventional-cutoffs-1.0",
  "dimensions": {
    "depression": { "rawScore": 0, "equivalentScore": 0, "category": "normal" },
    "anxiety": { "rawScore": 0, "equivalentScore": 0, "category": "normal" },
    "stress": { "rawScore": 0, "equivalentScore": 0, "category": "normal" }
  },
  "limitations": [
    "not_a_diagnosis",
    "conventional_categories_are_not_clinical_severity",
    "not_for_automated_treatment_or_safety_decisions"
  ]
}
```

Las tres dimensiones permanecen separadas; no hay categoría agregada ni identidad de cuenta en el DTO. `available` solo puede producirse con soporte aprobado para el mismo `instrumentVersionId`, motor, interpretación y base.

### No disponible

```json
{
  "schemaVersion": "1.0",
  "resultVersion": "dass21-internal-result-1.0",
  "status": "not_available",
  "assessmentId": "<uuid-sintético>",
  "reason": "interpretation_support_unavailable",
  "limitations": ["not_a_diagnosis", "not_for_participant_display"]
}
```

Los motivos incluyen evaluación incompleta, consentimiento faltante/desactualizado, score ausente/inválido, instrumento no disponible, mapeo no congelado y soporte interpretativo ausente. El DTO es interno; estos valores no se añaden a respuestas HTTP.

## Autorización y validación

`GetMyInternalDass21Result`:

1. Recibe `assessmentId` y la identidad del propietario desde su futuro caller de servidor; valida UUID y consulta `findByIdForOwner`.
2. Requiere evaluación `completed`, modo estructurado, versión fijada y 21 respuestas únicas `answered` de esa evaluación y versión.
3. Comprueba consentimiento `preliminary_assessment` actual y coincidente con el aviso fijado. Revalida después de leer score/mapeo.
4. Recupera únicamente una versión instrumental aprobada, vigente y disponible con 21 preguntas.
5. Lee score por `(assessmentId, accountId)`, valida schema, propietario, instrumento y versión.
6. Recupera el mapeo congelado exacto de ese score y confirma identificadores/versión.
7. Solicita soporte interpretativo a un puerto interno del servidor. Debe tener estado `approved`, referencia y fecha de aprobación, además de coincidir con la versión, motor y reglas. No existe campo cliente que pueda otorgar esa aprobación.
8. Llama al categorizador puro existente y construye el DTO. Cualquier ausencia, inconsistencia o error del checker/provider produce `not_available`.

La lectura de score está limitada por propietario en el repositorio Drizzle. Los detalles de errores internos no se incorporan al resultado.

## Política fail-closed y límites

- El adaptador `DenyDass21InterpretationSupport` es la política por defecto hasta que haya revisión profesional y soporte documentado; ninguna versión actual se considera aprobada para interpretación.
- Los consentimientos sintéticos de demo no constituyen aprobación psicométrica ni autorización para publicar puntuaciones.
- El score puede existir internamente, pero ni el resultado ni sus categorías se conectan a `/result`.
- El checker actual permite dos lecturas de autorización y revalidación antes de retornar, pero esa consulta no está ordenada en una única transacción con retiro/sustitución. Antes de conectarla a HTTP debe implementarse una lectura transaccional coordinada con el orden de locks de Consent, y probar la carrera retiro/lectura. Este pendiente no se oculta por la ausencia de endpoint.
- La versión española sigue pendiente de cotejo y revisión profesional. La regla convencional no demuestra validez local ni constituye severidad clínica.

## Criterios antes de conectar a `/result`

1. Seleccionar y aprobar profesionalmente la versión instrumental concreta y documentar sus condiciones de uso y adecuación a la población del estudio.
2. Aprobar explícitamente soporte de interpretación para la versión de instrumento, versión de scoring y reglas; no activar el proveedor deny hasta que exista evidencia autorizada.
3. Definir política jurídica/ética y de investigación: quién puede ver scores, para qué finalidad, consentimiento, retención, exportación, corrección y supresión.
4. Implementar autorización de lectura transaccional con Consent y ownership, y probar la concurrencia real en PostgreSQL de pruebas aislada.
5. Revisar el contrato HTTP/OpenAPI con responsables profesionales y frontend; solo entonces valorar feature gate y publicación controlada.
6. Añadir prueba HTTP de que `/result` permanece score-free por defecto y una prueba de regresión de denegación cuando soporte o consentimiento falta.

## Pruebas de este incremento

Tests unitarios sintéticos cubren salida válida determinista, propietario ajeno, evaluación incompleta, retiro/error de consentimiento, consentimiento revocado durante la lectura, score ausente o inconsistente, versión de instrumento no disponible, mapeo no disponible, soporte ausente y metadatos de limitación. Las pruebas preexistentes mantienen `/result` sin puntuaciones. No se ejecutaron pruebas PostgreSQL porque no se alteró el esquema ni la persistencia SQL.
