# Propuesta de administración y divulgación de resultados DASS-21

**Estado:** propuesta de revisión. Ningún escenario está aprobado ni habilitado.  
**Candidata:** `dass21-spanish-candidate-1.1`, `not_approved` / `not_available`.

## Regla de fuente que condiciona la decisión

UNSW dice que la administración informatizada puede automatizar el cálculo, pero que los puntajes calculados no deben entregarse a quienes responden ni debe intentarse interpretación automatizada para ellos. Para un sitio/app restringido a un grupo definido, la orientación de UNSW describe que los resultados se devuelvan al clínico/investigador, no al participante. La interpretación corresponde a personal con formación apropiada. Esta advertencia se incluye como restricción explícita de revisión y no se recomienda suprimirla. [FAQ oficial DASS](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

## Escenarios a deliberar

| Escenario | Descripción | Beneficios potenciales | Limitaciones/riesgos | Estado y condiciones |
|---|---|---|---|---|
| A — sin devolución al participante | En un protocolo futuro, el estudiante responde a una versión aprobada; el backend solo registra/calcula si la finalidad, consentimiento, retención, instrumento y protocolo lo autorizan. El participante no recibe puntajes ni categorías. | Es consistente con la orientación de UNSW para entregar resultados a investigador/profesional; evita que categorías de autoinforme se interpreten como diagnóstico. Puede permitir análisis de investigación bajo protocolo. | Puntajes son datos sensibles; el proyecto aún no define acceso de investigador, rol, auditoría ni retención. El consentimiento `preliminary_assessment` no demuestra por sí solo autorización específica para cálculo, uso secundario o retención. No hay API para investigadores y el scoring no está conectado al ciclo HTTP. | **Propuesta preferible para evaluación**, no aprobada. Requiere las aprobaciones y criterios del Checklist A; cualquier cálculo/retención necesita finalidad y acceso autorizados. |
| B — devolución de puntuaciones/categorías al estudiante | El frontend muestra puntajes y/o categorías después de completar. | Podría ofrecer feedback inmediato y visible. | Contradice la recomendación explícita de UNSW de no poner puntajes calculados a disposición de quienes responden y no hacer interpretación automatizada. Categorías convencionales pueden confundirse con diagnóstico, gravedad clínica o riesgo; sin protocolo aprobado existe riesgo de daño y falsa tranquilidad. | **Bloqueado; no recomendado.** No basta aprobar el cuestionario, tener un DTO, cambiar una bandera o aprobar internamente textos. Si se propone reconsiderarlo, debe existir resolución profesional, ética/jurídica y documentada sobre la discrepancia con la guía oficial antes de diseño/implementación; este expediente no presupone que tal excepción sea aceptable. |

La revisión puede concluir que no debe calcularse/retenerse resultado individual aunque el instrumento se apruebe para administración. La activación de instrumento y la divulgación son decisiones separadas.

## Checklist A — activar administración del cuestionario

**No habilitado actualmente.** Cada condición requiere evidencia identificable.

| Criterio | Evidencia exigida | Responsable | Estado actual | Aceptación |
|---|---|---|---|---|
| Selección y edición de traducción | Registro de selección que cite la copia, hash y límites de procedencia; revisión textual y del periodo | Psicólogo/a y responsable psicométrico | PENDIENTE; cotejo técnico 8A.7 hecho, autenticidad oficial no demostrada solo por hash | Aceptación profesional escrita de una edición exacta; mantener texto sin cambios no aprobados |
| Revisión de reactivos 1 y 12 | Revisión comparativa, justificación y decisión registrada sin reescritura automática | Psicólogo/a / revisor lingüístico | PENDIENTE | Decisión documentada conserva o detiene candidata; todo cambio exige nueva versión y autorización |
| Pertinencia poblacional | Evaluación de comprensión, contexto cultural y límites de evidencia para estudiantes de ingeniería de Lima Metropolitana | Responsable psicométrico e investigador principal | PENDIENTE | Aprobación documentada del uso/población o nueva validación según dictamen profesional |
| Instrumento y mapeo | Manifiesto 21/21, orden, dimensiones, etiquetas/opciones y scoring cotejados para la edición elegida | Responsable psicométrico + backend | Parcial técnico verificado; aprobación de uso PENDIENTE | Versionado e inmutabilidad; pruebas de integridad; versión no seleccionable hasta gate explícito |
| Uso/administración digital | Revisión de condiciones de uso, accesibilidad, consentimientos e interfaz | Asesoría jurídica/ética, investigador y equipo frontend | PENDIENTE | Evidencia escrita específica al protocolo digital |
| Consentimiento y privacidad | Texto de aviso/decisión, finalidades, retiro, retención, uso y límites comprensibles | Investigador, privacidad y asesoría ética/jurídica | PENDIENTE | Aprobación institucional/protocolo; no reutilizar consentimiento de demo |
| Tratamiento de respuestas sensibles | Procedimiento de privacidad y alcance de respuesta ante contenido sensible, sin clasificador inventado | Responsable clínico y comité de ética | PENDIENTE | Protocolo aprobado, responsable y capacidad institucional definidos; no inferir riesgo automático |
| Publicación técnica del instrumento | Nueva versión aprobada, completa e inmutable en catálogo aislado; autorización de publicación servidor-side | Investigación/profesional y backend release owner | PENDIENTE | Gate server-side con cierre seguro, pruebas de catálogo/HTTP/PostgreSQL y revisión de contrato |

## Checklist B — publicar puntuaciones o categorías

**Decisión independiente y actualmente denegada por defecto.** Completar Checklist A no satisface este checklist.

| Criterio | Evidencia exigida | Responsable | Estado actual | Aceptación |
|---|---|---|---|---|
| Política de resultados | Decisión expresa de si se calculan, quién puede acceder y si hay devolución | Investigador principal + psicólogo/a + comité de ética | PENDIENTE | Documento aprobado separado del permiso de administrar cuestionario |
| Advertencia UNSW | Análisis escrito de la prohibición/recomendación de no devolver puntajes/interpretación automática a encuestados; consulta formal si se propone escenario B | Investigador, psicólogo/a y asesoría institucional | PENDIENTE | No puede marcarse aceptado por ignorar o borrar la advertencia; resolución de compatibilidad y alcance documentada |
| Rangos e interpretación | Revisión de `dass21-conventional-cutoffs-1.0` para versión y población concretas; límites de cada categoría | Responsable psicométrico | PENDIENTE | Aprobación/versionado independiente; no afirmar severidad clínica ni diagnóstico |
| Textos para participantes | Aprobación de cada texto, lenguaje claro y accesible, riesgos y límites | Psicólogo/a y comunicación accesible | PENDIENTE | Revisión profesional y ética trazable; no generar textos clínicos por IA |
| Acceso de investigador/profesional | Roles, alcance de estudio, mínimo privilegio, autenticación y auditoría | Investigador, privacidad y backend | PENDIENTE; no existe endpoint/rol de lectura | Modelo de autorización revisado, probado y separado de la cuenta estudiante |
| Consentimiento y retención | Finalidad explícita para cálculo/retención/devolución, duración, revocación, exportación, corrección y supresión | Investigación, privacidad y asesoría ética/jurídica | PENDIENTE | Aprobación de política específica; retiro bloquea operaciones futuras conforme a política aprobada |
| Gate de servidor | Soporte aprobado vinculado a instrumento/motor/interpretación concretos; denegación predeterminada | Profesional/research owner + backend release owner | PENDIENTE; proveedor actual deniega | Fail closed; sin bandera o dato del cliente que suplante aprobación |
| Contrato HTTP y seguridad | OpenAPI y DTO revisados, pruebas de ownership/consentimiento/concurrencia/no filtración y contrato actual preservado hasta la autorización | Backend, seguridad y frontend | PENDIENTE; existe solo contrato futuro documentado | Aprobación de cambio de API y pruebas por ambiente autorizado antes de conectar adaptador |

## Contrato frontend: actual frente a futuro

La referencia completa es [docs/frontend-dass21-results-contract.md](frontend-dass21-results-contract.md).

**Disponible hoy:** `GET /api/v1/preliminary-assessments/:id/result` devuelve el `AssessmentResult` histórico con puntuaciones/interpretación `not_available`; no devuelve `rawScore`, `equivalentScore` ni categorías. La candidata no está disponible desde el catálogo. El frontend puede manejar `not_available` sin representarlo como cero.

**Preparado pero no disponible:** `dass21-participant-result-1.0` define hipotéticamente `status`, `assessmentId`, instrumento/versiones, tres dimensiones con bruto/equivalente/categoría, `isDiagnostic: false` y limitaciones. El componente OpenAPI y `toDass21ParticipantResult` no están conectados a `/result`. Su existencia no permite consumirlo como respuesta HTTP actual.

## Comportamiento recomendado para frontend mientras siga bloqueado

- Mantener compatibilidad solo con el contrato actual del backend y su estado `not_available`.
- No presentar el cuestionario Daza ni sus reactivos, porque la candidata no está en catálogo/disponible.
- No construir una pantalla que suponga que el DTO futuro está habilitado.
- Si hay UI genérica de evaluación para otros instrumentos disponibles, consultar el catálogo backend y mostrar únicamente instrumentos/versiones efectivamente publicados; no inferir la disponibilidad de DASS-21 por esta documentación.
- No guardar scores, categorías o reactivos en almacenamiento local como anticipación de la futura integración.
- Mantener escenarios A y B separados en diseño y feature planning; un endpoint futuro requeriría autorización nueva y explícita.
