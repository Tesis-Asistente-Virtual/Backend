# Sprint 5B.5 — Plan de activación técnica de DASS-21

## Objetivo y estado

Este documento prepara una posible activación futura. No selecciona una traducción, no publica un instrumento, no habilita puntuación automática y no constituye aprobación clínica, ética, jurídica ni psicométrica.

| Estado | Hechos de esta revisión |
|---|---|
| **Implementado** | API de PreliminaryAssessment con catálogo, inicio, respuestas, pausa, reanudación, retiro, finalización y consulta del resultado público. Consentimiento versionado y revalidación transaccional antes de escrituras sensibles. |
| **Preparado** | Motor determinista `dass21-score-1.0`, mapeo UUID↔número de ítem versionado/congelable, persistencia interna separada y `ScoreCompletedDass21Assessment`. El servicio 5B.4 no está compuesto en REST, ciclo de finalización, jobs ni conversaciones. |
| **Pendiente** | Selección y revisión de una traducción española concreta; evaluación de adecuación a universitarios de Lima Metropolitana; autorización de uso digital; decisión de consentimiento, resultados, roles, retención, exportación y supresión. |
| **Bloqueado** | No se ha cargado una versión española real ni un cuestionario DASS-21 aprobado. No hay acceso interno de lectura a puntuaciones ni roles de investigador/profesional implementados. Por tanto, no se debe presentar un formulario DASS como disponible ni activar el scoring. |

Las pruebas y datos sintéticos de desarrollo no acreditan que una versión real esté aprobada o publicada.

## Contratos de PreliminaryAssessment hoy

Las rutas están montadas bajo `/api/v1/preliminary-assessments`; todas requieren JWT Bearer. `accountId` se obtiene del token, nunca del cuerpo.

| Método y ruta | Contrato actual | Consentimiento y respuesta |
|---|---|---|
| `GET /info` | Sin body. Responde `{assessmentAvailable, mode, instruments:[{instrumentId,instrumentVersionId,version,effectiveAt,questions}]}`. | JWT; no requiere consentimiento para consultar el catálogo. `instruments: []` significa que no hay una versión disponible en ese momento. |
| `POST /` | Body estricto `{instrumentVersionId: UUID}`. | Requiere `preliminary_assessment` vigente. 201 con recurso de evaluación. No crea evaluación si la versión no está disponible. |
| `GET /` | Query opcional `limit` (1–99, default 20) y `offset` (0–1,000,000, default 0). | JWT; solo registros propios. `{items, pagination:{limit,offset,hasMore}}`. |
| `GET /:id` | UUID de evaluación. | JWT; solo propietaria. Devuelve el recurso y las respuestas actuales guardadas. |
| `POST /:id/responses` | Body estricto `{questionId: UUID, answer: null | {type:"text",value} | {type:"number",value} | {type:"single_choice",optionId} | {type:"multiple_choice",optionIds} | {type:"boolean",value}}`. | Exige evaluación `in_progress`, pregunta de la versión fijada y consentimiento vigente, revalidado en transacción. 200 con una respuesta. Una respuesta previa a la misma pregunta se reemplaza. |
| `POST /:id/pause` | Body omitible o `{}`. | JWT/propietaria; pausa una evaluación `in_progress`. No exige consentimiento porque no permite continuar ni añadir datos. |
| `POST /:id/resume` | Body omitible o `{}`. | Requiere consentimiento vigente y versión asociada coincidente. |
| `POST /:id/withdraw` | Body omitible o `{}`. | Retira la evaluación abierta; no elimina por sí mismo respuestas ya almacenadas. |
| `POST /:id/complete` | Body omitible o `{}`. | Requiere todas las preguntas obligatorias respondidas y consentimiento vigente. Estado y resultado público `not_available` se guardan atómicamente. Reintento de una evaluación ya completada devuelve el resultado público existente. |
| `GET /:id/result` | UUID de evaluación. | Solo propietaria y evaluación completada. Devuelve las secciones `instrumentScores`, `interpretation`, `attentionPriority` como `not_available` y `safetyState` como no evaluada. No consulta ni expone la tabla de puntajes psicométricos. |

Los errores REST usan `{error:string}` y no incluyen respuestas ni SQL. Entre los estados documentados están 400 por request inválido, 401 sin JWT válido, 403 por consentimiento requerido, 404 para evaluación/resultado inexistente o ajena y 409 para instrumento no disponible, transición/estado incompatible, respuestas incompletas o conflicto concurrente.

### Contratos de consentimiento relacionados

- `GET /api/v1/consents/notices` (público): lista avisos vigentes como `[{id,purpose,version,content,effectiveAt}]`.
- `GET /api/v1/consents/me` (JWT): `items:[{purpose,state,currentNoticeVersion,changedAt}]`; los estados incluyen `granted`, `declined`, `withdrawn`, `not_decided` y `renewal_required`.
- `POST /api/v1/consents/me/decisions` (JWT): body estricto `{purpose,noticeVersionId,action,idempotencyKey}`; `action` es `granted|declined|withdrawn`; devuelve 201 `{id,purpose,noticeVersionId,action,createdAt}`. Para iniciar evaluación la finalidad debe ser `preliminary_assessment`, y la versión concedida debe ser el aviso vigente exacto.

Una sesión autenticada no equivale a consentimiento. No se deben intercambiar finalidades.

## Candidatas de versión española: decisión humana pendiente

UNSW publica varias traducciones españolas. La página funciona como catálogo de traducciones compartidas; la FAQ indica que la inclusión no es garantía de calidad de una traducción. La presencia en la página tampoco acredita adecuación a Perú, a universitarios de ingeniería de Lima ni autorización para este proyecto digital.

| Candidata publicada por UNSW | Procedencia que consta en la fuente | Evidencia citada en el catálogo | Preguntas para psicología / investigación |
|---|---|---|---|
| Daza et al. | Traducción DASS-21. | El catálogo cita Daza et al. (2002), traducción española y validación con una muestra hispana, y Novy et al. (2001) sobre comparabilidad psicométrica español/inglés. Hay que revisar los artículos, su población, método y resultados antes de inferir aplicabilidad. | ¿La población estudiada y la forma de administración son pertinentes para Perú? ¿La traducción exacta, permisos y adaptación requieren revisión local? |
| Bados López | Traducción de DASS y DASS-21 por Arturo Bados López. | La página identifica al traductor y versiones, pero el catálogo no cita allí una validación específica para la versión publicada. | ¿Hay evidencia técnica adicional para la variante exacta? ¿Es apropiada para el lenguaje local y el grupo objetivo? |
| García Valenzuela | Traducciones DASS y DASS-21. | La página indica que se dirige a hispanohablantes de Latinoamérica, pero no cita un estudio de validación en esa misma página. | ¿La indicación regional basta para considerar la redacción? No: revisar evidencia, país/muestra, equivalencia y condiciones de uso. |
| IQVIA | Traducción DASS-21. | La página describe traducción, verificación en dos pasos y retrotraducción; no lista allí una validación psicométrica poblacional. | ¿Qué documentación completa de adaptación y validación puede revisarse? ¿Qué población y derechos cubre? |

No se selecciona automáticamente ninguna. García Valenzuela puede incluirse en la agenda por la descripción regional que publica la fuente, no como recomendación de adopción. La decisión debe identificar **el artefacto textual exacto, su versión/procedencia y condiciones de uso**, no solo el nombre del traductor.

La forma estándar DASS-21 de UNSW consta de 21 reactivos, respuestas de 0 a 3 y referencia a la semana previa; la puntuación de subescala se multiplica por dos para equivalencia con DASS-42. No se reproducen aquí ítems. Cambiar redacción o periodo cambia la comparabilidad y requiere decisión documentada. Para esta tesis el backend exige las 21 respuestas obligatorias; la política de datos faltantes no debe relajarse sin aprobación profesional y ajuste del contrato.

UNSW advierte que la interpretación corresponde a personas con formación psicológica adecuada; sus FAQ desaconsejan mostrar puntajes directamente al respondiente y señalan riesgos de interpretación automática fuera de contexto. La FAQ también contempla uso digital limitado a grupos definidos, con resultados dirigidos a clínico/investigador en vez de al participante. Esa guía no sustituye revisión local, ética, legal ni de seguridad.

### Matriz para decisión del profesional

| Criterio | Evidencia a reunir | Decisión requerida |
|---|---|---|
| Fidelidad | Comparar versión española exacta con fuente/versión, sin cambios editoriales accidentales. | Profesional psicólogo y responsable psicométrico. |
| Población | Estudios de fiabilidad/validez, país, edad, idioma, contexto universitario y límites de generalización. | Psicólogo + asesor metodológico; decidir si exige validación/adaptación local. |
| Periodo e instrucciones | Confirmar la referencia temporal oficial y que UI no la parafrasee. | Psicólogo y titular de investigación. |
| Administración digital | Usabilidad, accesibilidad, privacidad en pantalla, reanudación, sesgo por dispositivo y equivalencia papel/digital. | Psicólogo, ética y equipo de investigación. |
| Puntuación | Aprobación independiente del mapeo de los 21 IDs y del motor; verificación con casos de referencia licenciados/autorizados. | Responsable psicométrico; revisión de código y pruebas. |
| Derecho de uso | Términos concretos para reproducción digital, adaptación, almacenamiento y publicación. | Asesor jurídico/titular de derechos; no inferir de acceso público. |
| Comunicación | Si el estudiante recibe confirmación, orientación general o puntajes; lenguaje, límites y derivación. | Psicología, ética y asesor legal; hoy puntajes bloqueados a la vista del estudiante. |

## Flujo propuesto cuando se apruebe una versión

1. **Autenticación**: la cuenta obtiene JWT; todos los endpoints de evaluación usan Bearer. Identidad y ownership se derivan del token.
2. **Avisos**: frontend consulta avisos y estado actual; muestra el aviso vigente completo de `preliminary_assessment` y permite decisión explícita. Rechazo o ausencia bloquea el inicio. No reutilizar consentimiento para chat/extracción/monitoreo.
3. **Catálogo**: consulta `GET /info`. Solo una versión disponible que aparezca en este catálogo puede seleccionarse. El backend verifica estado `approved`, metadatos de aprobación, licencia y vigencia; esos campos técnicos no prueban por sí solos aprobación ética/legal.
4. **Inicio**: `POST /` con el `instrumentVersionId` exacto mostrado. La evaluación queda ligada a esa versión y a la versión de aviso aceptada.
5. **Presentación**: UI obtiene definición, instrucciones y opciones desde el contrato aprobado, no crea ni traduce reactivos. Antes de activar hay que resolver la recuperación de preguntas de la versión fijada (ver bloqueos).
6. **Respuestas/progreso**: envía cada respuesta explícitamente. Puede consultar `GET /:id`, que incluye respuestas actuales y estado; esa lectura revela las respuestas al titular de la cuenta y debe permanecer privada. La UI puede guardar localmente el índice de pantalla, pero el servidor no ofrece actualmente una posición de cursor.
7. **Pausa/reanudación**: pausa permite detenerse. Reanudar exige consentimiento todavía vigente y versión coincidente. Si se sustituyó el aviso, se rechaza la operación. No hay flujo existente para volver a vincular la evaluación en curso a una nueva versión de aviso; decidir si debe abandonarse y reiniciarse o añadirse una reautorización explícita.
8. **Finalización**: solo tras contestar todas las preguntas requeridas. `POST /:id/complete` cierra la evaluación y crea el resultado público no puntuado. La UI muestra confirmación de envío/completitud, nunca una categoría clínica.
9. **Cálculo interno futuro**: después de aprobar el instrumento y la política de acceso, una nueva orquestación controlada invocaría el servicio interno. Actualmente el servicio no se ejecuta con finalización HTTP y no existe endpoint de lectura de puntajes.
10. **Acceso/revisión**: cualquier acceso de investigador/profesional necesita un sistema de roles y alcance del estudio, controles de acceso mínimo, auditoría de lectura, finalidad, exportación y política de retención/supresión. No existe ahora un endpoint de ese tipo.

## Diseño recomendado para futura activación del scoring

### Consistencia

El servicio 5B.4 es una operación interna separada: recibe `accountId` de una frontera confiable junto con `assessmentId` y `mappingVersion`; valida consentimiento, propiedad, evaluación completada, instrumento disponible, mapeo congelado y respuestas; calcula sin proveedor externo; y persiste puntuación interna en una transacción con revalidación de consentimiento. Los reintentos idénticos devuelven la fila previa; diferencias de contenido/versiones dan conflicto. El acceso de escritura no ofrece un puerto público de lectura.

El endpoint actual de finalización ya confirma estado `completed` y `assessment_results` con secciones `not_available` en una sola transacción. **No basta con llamar al servicio 5B.4 después del commit y devolver éxito como si todo fuese una unidad**, porque puede quedar evaluación completada sin puntuación interna si la segunda escritura falla. Tampoco se debe abrir una transacción/lock mientras se realiza cálculo ajeno; el cálculo es local y determinista, por lo que no requiere llamada externa.

Recomendación antes de activarlo para un instrumento real: mover la orquestación de finalización a un límite de unidad de trabajo transaccional que, para la versión elegible, valide/compile el score y persista estado de evaluación, resultado público no disponible y puntuación interna en una única transacción. Reutilizar orden de locks de consentimiento (cuenta → aviso vigente → evaluación → mapeo según las operaciones existentes), revalidar decisión y aviso exactos y mantener una unicidad por evaluación. Crear el objeto de score desde snapshot completo e inmutable de respuestas; las respuestas no se pueden editar tras completar. Mantener contrato HTTP sin campos psicométricos; falla atómica y error seguro si cualquier persistencia falla. Confirmar/reintentar la solicitud completa de forma idempotente.

Si una sola transacción resultara inadecuada, alternativa es un proceso posterior **fiable** (outbox/estado de cálculo durable, reintentos y reconciliación); hoy no existe esa infraestructura. No usar una tarea en memoria o fire-and-forget. El retiro debe ordenarse con la escritura final: si el retiro/aviso reemplazado gana, no se calcula/guarda; si la finalización autorizada gana, queda ordenada antes del retiro. Definir con responsables si una puntuación ya calculada permanece, se restringe o se suprime; no borrarla automáticamente sin política aprobada.

### Separación de resultados

- **Puntaje psicométrico interno**: datos sensibles con tabla y contrato separados; acceso mínimo no disponible por API.
- **Resultado público de evaluación**: actualmente solo valores `not_available`; el endpoint no debe convertirse accidentalmente en canal de scores.
- **Confirmación del estudiante**: estado de recepción/completitud y siguiente paso informativo aprobado, sin interpretación, score, severidad ni diagnóstico.
- **Resultado conversacional**: bounded context aparte, descriptivo y efímero; no combinarlo con resultados de instrumento.

No existe actualmente RBAC de investigadores/profesionales en este módulo. El claim JWT usado es `accountId`; no se debe simular rol con IDs o flags del cliente.

## Bloqueos técnicos concretos antes de habilitar el formulario

1. **Orden de reactivos no contractual**: `DrizzleInstrumentCatalog` ordena las filas por `questionId` UUID. El esquema de pregunta no contiene `displayOrder` ni el endpoint expone el mapeo oficial. Ordenar por UUID no garantiza el orden oficial. Añadir orden de presentación versionado y prueba de orden, separado del mapeo de scoring; no depender de orden de DB.
2. **Recuperar la versión fijada**: `GET /info` enumera solo instrumentos actualmente disponibles; `GET /:id` devuelve `instrumentVersionId` y respuestas, pero no las definiciones/preguntas. Si la versión deja de estar disponible mientras existe una evaluación, no hay endpoint versionado para recuperar sus preguntas exactas. Diseñar una consulta de snapshot por assessment propio o incluir snapshot inmutable en recurso de evaluación antes de UX de reanudación.
3. **Consentimiento sustituido en una evaluación abierta**: las operaciones de respuesta/reanudación/finalización requieren que el aviso actual coincida con el ID guardado en la evaluación. Si hay una versión nueva, aceptar el aviso nuevo no actualiza ese vínculo; resolver UX/política para renovación de consentimiento o reinicio, sin saltarse la autorización.
4. **Revisión operativa de aprobación**: instrument status, `approvalReference` y licencia son campos técnicos; definir quién puede publicar, evidencia admisible y segregación de funciones antes de cargar un instrumento real.
5. **Acceso a resultados**: no hay autorización por rol ni consulta interna de score. Diseñar RBAC, alcance de estudio, auditoría de lectura y minimización antes de cualquier panel de investigador/profesional.

## Privacidad: decisiones pendientes

Antes de piloto, acordar con responsables humanos: datos mínimos y propósito; quién accede; manejo de retiro; retención y plazo; supresión y tratamiento de respaldos; derechos de acceso/exportación/corrección; acceso de investigación; notificación de incidentes; registros de auditoría que no contengan respuestas; flujo ante consentimiento renovado; si los scores existen siquiera en operación. No inferir periodos legales. Retirar consentimiento no borra automáticamente evaluación, respuestas ni score ya guardados; la política actual permite detener nuevas operaciones pero no implementa borrado retroactivo.

## Checklist verificable de activación

- [ ] Psicólogo y responsable psicométrico identifican una versión española concreta y revisan ítems/instrucciones sin cambios no autorizados.
- [ ] Revisados artículos primarios, población de validación, equivalencia y límites para universitarios peruanos.
- [ ] Uso digital y derechos confirmados documentalmente por titular/asesoría jurídica.
- [ ] Aprobaciones ética/institucionales requeridas obtenidas antes de reclutar.
- [ ] Política de consentimiento y texto aprobado por revisión jurídica/ética; finalidad y aviso corresponden al tratamiento real.
- [ ] Política de resultados, roles, retención, exportación, supresión y retiro documentada y aprobada.
- [ ] 21 definiciones de pregunta completas y exactas; opciones y periodo verificados contra fuente aprobada; no basta el conteo.
- [ ] Orden de presentación explícito y versionado; no se deriva de UUID.
- [ ] Mapeo UUID↔número cargado y congelado para la versión concreta; segunda revisión independiente.
- [ ] Motor `dass21-score-1.0` validado contra ejemplos de scoring autorizados y casos límite; sin categorías ni diagnósticos en DTO.
- [ ] Integración transaccional de finalización/puntuación, idempotencia, retiro concurrente y error de persistencia probados.
- [ ] La consulta de progreso recupera la versión fijada y maneja sustitución/retirada de instrumento.
- [ ] Tests unitarios, PostgreSQL, HTTP integral y autorización de acceso a resultados pasan en bases aisladas.
- [ ] OpenAPI refleja contratos efectivos y el frontend no recibe puntuaciones por endpoint público.
- [ ] Observabilidad revisada para que no registre respuestas, reactivos, puntajes ni tokens.
- [ ] Validación de accesibilidad y usabilidad con protocolo ético aprobado.

## Próximos incrementos por dependencia

1. **Decisión humana de instrumento**: revisar matriz anterior y documentar fuente, versión exacta, derechos y alcance de uso.
2. **Cerrar contratos de presentación/progreso**: resolver `displayOrder`, recuperación de versión fijada y reconsentimiento cuando cambia el aviso.
3. **Cerrar privacidad y acceso**: aprobar política de resultados y decidir si/cuándo habrá rol investigador; no construir lectura de scores antes.
4. **Cargar versión controlada**: solo tras aprobaciones, con proceso versionado, inmutable, revisión de 21 ítems y mapeo; datos aislados primero.
5. **Integración transaccional**: acoplar scoring a finalización por unidad de trabajo atómica y revalidación de consentimiento; probar fallo/retirada/idempotencia.
6. **Validación HTTP integral**: probar el flujo autenticado, consentimiento, progreso y finalización con fixture aprobado en ambiente de prueba autorizado.
7. **Activación gradual**: feature gate explícito sujeto a aprobación, documentación y pruebas de salida; nunca habilitar por la sola existencia de una fila `approved` de fixture.

## Fuentes primarias consultadas

- [UNSW: Spanish translations](https://www2.psy.unsw.edu.au/dass/Spanish/Spanish.htm) — catálogo y procedencia publicada de las cuatro candidatas.
- [UNSW: DASS FAQ](https://dass.psy.unsw.edu.au/DASSFAQ.htm) — interpretación, uso en contextos digitales, puntuación y límites de las traducciones publicadas.
- [UNSW: DASS-21 form](https://dass.psy.unsw.edu.au/Download%20files/Dass21.pdf) — estructura e instrucciones de la versión estándar; no se reproducen sus reactivos.
- [UNSW: DASS scoring template](https://www2.psy.unsw.edu.au/groups/dass/Download%20files/Dass_template.pdf) — suma por subescala y equivalencia DASS-21 ×2.
- [Daza et al. candidate page](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm), [Bados López](https://www2.psy.unsw.edu.au/dass/Spanish/Bados%20Lopez.htm), [García Valenzuela](https://www2.psy.unsw.edu.au/dass/Spanish/Garcia_Valenzuela.htm), [IQVIA](https://www2.psy.unsw.edu.au/dass/Spanish/IQVIA.htm) — páginas de cada traducción; consultarlas junto con sus artículos/documentos, no como aval de uso.

## Historial

- Sprint 5B.5: plan preparado a partir del código y OpenAPI actuales. No se cargaron ítems, no se cambió código de producción y no se seleccionó una traducción.
