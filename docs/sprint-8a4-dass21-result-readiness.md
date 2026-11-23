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

`GetMyInternalDass21Result` ahora usa `DrizzleDass21InternalResultReadUnitOfWork`. Una sola transacción de PostgreSQL incluye autorización, lectura y construcción del DTO:

1. Valida los UUID recibidos desde el futuro caller interno.
2. Bloquea y comprueba la cuenta y el aviso publicado vigente para `preliminary_assessment`, junto con la última decisión `granted`.
3. Lee y bloquea el assessment solo por `(assessmentId, accountId)`, y exige que el aviso fijado por la evaluación coincida con el vigente.
4. Bloquea las respuestas y exige assessment `completed`, modo estructurado, 21 respuestas únicas contestadas y versión consistente.
5. Bloquea la versión instrumental aprobada y efectiva, sus preguntas, el mapeo congelado y el score de la misma cuenta; valida schemas, relaciones, versiones y rangos.
6. Consulta el proveedor síncrono local de soporte interpretativo. El proveedor no hace I/O externo durante la transacción y solo una aprobación del servidor que coincida en instrumento, motor, interpretación y fecha permite construir el resultado.
7. Construye el DTO antes de cerrar la transacción. Un error transaccional devuelve `not_available` con `authorization_unavailable`; no hay resultado parcial ni detalle SQL.

## Frontera de lectura y concurrencia (Sprint 8A.5)

El orden de locks sigue el patrón compartido por Consent y las escrituras del módulo: **cuenta → aviso vigente → assessment → respuestas → versión/preguntas del instrumento → score → mapeo**. Consent bloquea la cuenta con `FOR UPDATE` para registrar decisiones; la lectura adquiere `FOR SHARE`. La actualización o sustitución del aviso vigente también debe esperar al lock compartido de esa fila. Las operaciones de assessment/scoring toman sus locks de assessment después de los locks de Consent, por lo que no pueden cambiar estado, reautorizar ni escribir score a mitad de la lectura.

Así, si el retiro o reemplazo obtiene primero los locks, la lectura posterior observa la autorización denegada/obsoleta y falla cerrada. Si la lectura los obtiene primero, termina de construir el resultado dentro de la transacción antes de que el cambio de consentimiento o estado pueda confirmarse. La lectura no mantiene locks durante llamadas externas: el soporte interpretativo es un lookup síncrono, local y del servidor.

El DTO agrega el motivo interno `authorization_unavailable` para fallos de transacción/infraestructura. Los fallos de consentimiento siguen siendo `consent_required`; el contrato no se expone por HTTP. No se introdujo ruta, tabla ni migración.

## Política fail-closed y límites

- El adaptador `DenyDass21InterpretationSupport` es la política por defecto hasta que haya revisión profesional y soporte documentado; ninguna versión actual se considera aprobada para interpretación.
- Los consentimientos sintéticos de demo no constituyen aprobación psicométrica ni autorización para publicar puntuaciones.
- El score puede existir internamente, pero ni el resultado ni sus categorías se conectan a `/result`.
- La lectura está ordenada con los locks del flujo de Consent y de las escrituras de assessment/scoring. La integración PostgreSQL de concurrencia debe ejecutarse en `tesis_test_db` antes de cualquier composición futura; no se conectó a HTTP.
- La versión española sigue pendiente de cotejo y revisión profesional. La regla convencional no demuestra validez local ni constituye severidad clínica.

## Criterios antes de conectar a `/result`

1. Seleccionar y aprobar profesionalmente la versión instrumental concreta y documentar sus condiciones de uso y adecuación a la población del estudio.
2. Aprobar explícitamente soporte de interpretación para la versión de instrumento, versión de scoring y reglas; no activar el proveedor deny hasta que exista evidencia autorizada.
3. Definir política jurídica/ética y de investigación: quién puede ver scores, para qué finalidad, consentimiento, retención, exportación, corrección y supresión.
4. Ejecutar la prueba focalizada de concurrencia de lectura contra PostgreSQL de pruebas aislada y revisar el resultado.
5. Revisar el contrato HTTP/OpenAPI con responsables profesionales y frontend; solo entonces valorar feature gate y publicación controlada.
6. Añadir prueba HTTP de que `/result` permanece score-free por defecto y una prueba de regresión de denegación cuando soporte o consentimiento falta.

## Pruebas de este incremento

Tests unitarios sintéticos cubren salida válida determinista, orden de autorización antes de leer datos, propietario ajeno, evaluación incompleta/reautorizada, retiro/error de consentimiento, score ausente o inconsistente, versión de instrumento no disponible, mapeo no disponible, soporte ausente, fallo de transacción y metadatos de limitación. Las pruebas preexistentes mantienen `/result` sin puntuaciones. La prueba PostgreSQL de concurrencia queda pendiente si `TEST_DATABASE_URL` no está disponible y validada como `tesis_test_db`. Para ejecutarla localmente después de configurar esa variable segura: `npx vitest run tests/integration/dass21-postgres.integration.test.ts`.
