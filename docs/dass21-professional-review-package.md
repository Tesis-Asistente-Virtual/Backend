# Expediente de revisión profesional DASS-21

**Estado del expediente:** preparado para revisión; no constituye aprobación clínica, ética, jurídica ni autorización de uso.  
**Candidata:** `dass21-spanish-candidate-1.1` — `not_approved` / `not_available`.  
**Fecha de corte documental:** 2026-11-23.

## Propósito

Reunir la evidencia técnica disponible y registrar decisiones que deben resolver responsables humanos antes de cargar o habilitar DASS-21. Este expediente no cambia el instrumento, el consentimiento, el backend ni el contrato HTTP.

## Ficha técnica candidata

| Campo | Evidencia/estado |
|---|---|
| Instrumento | Depression Anxiety Stress Scales, forma breve DASS-21; autoinforme de 21 reactivos |
| Traducción candidata | Daza, Novy, Stanley y Averill (2002), traducción española validada en una muestra hispana según la referencia publicada |
| Versión técnica | `dass21-spanish-candidate-1.1`; es descriptor candidato, no `InstrumentVersion` ni versión aprobada |
| Fuente declarada | [Ficha Daza de UNSW](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm), que enlaza `DASS21_Spanish_Daza.doc` |
| Copia cotejada | Copia local del `.doc`; SHA-256 `b673e8b99bd521b856555e528daf8d4b1320a9928fe07114f26be6ac17ba021a`, coincide con el hash esperado del solicitante. El hash no prueba por sí solo origen/autenticidad |
| Cotejo técnico | 21 reactivos secuenciales; instrucciones y periodo “durante la semana pasada”; cuatro opciones con etiquetas fuente y valores internos 0–3; reactivos 1 y 12 muy similares, distintos y preservados |
| Dimensiones | Depresión, ansiedad y estrés, siete reactivos por dimensión, asignación cotejada contra la [plantilla oficial de puntuación UNSW](https://dass.psy.unsw.edu.au/Download%20files/Dass_template.pdf) |
| Scoring | `dass21-score-1.0`: suma de los siete valores 0–3 por dimensión; equivalente = suma bruta ×2 |
| Categorización preparada | `dass21-conventional-cutoffs-1.0`, rangos convencionales por dimensión; no existe dimensión global |
| Interpretación | Etiquetas de rangos del instrumento; no son diagnóstico, severidad clínica individual, prueba de ausencia de problemas ni evaluación de riesgo |
| Estado | Sin revisión profesional documentada, sin aprobación, sin publicación y sin disponibilidad para participantes |

La página oficial de traducciones de Daza indica que sigue el orden del DASS-21 inglés y remite a la clave. La clave oficial consultada coincide con el mapa y el ×2 del motor. Este cotejo técnico no demuestra pertinencia cultural, validez para la población concreta ni aprobación de la interpretación para este proyecto. [Ficha Daza](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm), [FAQ UNSW](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

## Implementación real y límites

- El motor, categorizador, resolución `optionId` → `scoringValue`, persistencia interna y lectura transaccional existen como componentes internos.
- La candidata no está cargada en el catálogo y no es seleccionable por el flujo de formularios.
- `ScoreCompletedDass21Assessment` no está conectado a finalización HTTP, jobs ni automatizaciones.
- El proveedor de soporte interpretativo predeterminado deniega soporte (`DenyDass21InterpretationSupport`).
- `GET /api/v1/preliminary-assessments/:id/result` conserva el contrato actual con estados `not_available`; no devuelve puntuaciones ni categorías DASS-21.
- `dass21-participant-result-1.0` es futuro/documentado; el adaptador puro no está conectado al router.
- No hay endpoint de lectura para investigadores/profesionales ni roles de estudio implementados.
- Safety y seguimiento longitudinal real permanecen inactivos.

## Advertencia de la fuente

UNSW indica que los resultados calculados no deben ponerse a disposición de quienes responden y que no se debe intentar interpretación automatizada para ellos, porque puede inducir a error y ser peligrosa. También indica que la interpretación debe realizarla personal con formación adecuada. Para administración en web/app restringida a participantes, UNSW describe la devolución de resultados al profesional/investigador, no al participante. Esta advertencia se conserva y no debe suprimirse de la revisión. [FAQ oficial DASS](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

La evidencia peruana citada por el expediente de 8A.7 estudia 1.163 estudiantes de una universidad pública de Lima; sus resultados no deciden por sí solos la versión exacta, pertinencia para estudiantes de ingeniería de Lima Metropolitana ni la devolución de resultados en este producto. [Cirilo-Acero et al. (2025)](https://www.scielo.org.pe/scielo.php?pid=S1726-46342025000300291&script=sci_arttext).

## Paquete de revisión

1. Revisar la [matriz de decisiones](dass21-authorization-decision-matrix.md); completar responsable identificado, decisión, evidencia, referencia y fecha solo cuando ocurra una revisión real.
2. Evaluar los escenarios y checklists independientes en la [propuesta de divulgación](dass21-results-disclosure-proposal.md).
3. Contrastar el contrato futuro con la [guía frontend DASS-21](frontend-dass21-results-contract.md). El documento futuro no es una API habilitada.
4. Adjuntar aprobaciones reales en el repositorio de investigación institucional o citar una referencia controlada; no agregar nombres, firmas ni aprobaciones supuestas a estos documentos.

## Evidencia técnica de verificación

El Sprint 8A.7 documenta lectura del archivo en Word protegido, hash coincidente, estructura de 21 reactivos y cotejo con plantilla oficial. La implementación candidata y sus pruebas están en `src/modules/preliminary-assessment/domain/model/dass21-spanish-candidate.ts` y `tests/modules/preliminary-assessment/dass21-spanish-candidate.test.ts`.

El contexto del Sprint informa 417 pruebas unitarias y 5/5 pruebas PostgreSQL aprobadas para la lectura transaccional. Esos son antecedentes reportados; este expediente documental no volvió a ejecutar pruebas. No se encontró un documento independiente `sprint-8a5` ni `sprint-8a6`; las garantías 8A.5 se apoyan en el código y test de integración, y el contrato 8A.6 en `docs/frontend-dass21-results-contract.md` y el OpenAPI/código correspondiente.

## Condición actual

La candidata sigue bloqueada para cargar en un catálogo habilitado, administrar a participantes, calcular/persistir resultados de participantes y publicar resultados. La revisión del expediente puede continuar sin cambiar ese estado.
