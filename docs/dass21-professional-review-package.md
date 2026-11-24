# Expediente de revisión profesional DASS-21

**Estado del expediente:** constancia profesional recibida y registrada para revisión; no constituye por sí sola aprobación institucional, ética, jurídica ni autorización de uso con participantes.  
**Candidata:** `dass21-spanish-candidate-1.1` — `not_approved` / `not_available`.  
**Fecha de corte documental:** 2026-11-24.

## Evidencia profesional recibida

Se recibió `Autorizacion Psicologica.pdf`, fechado 2026-11-23, con SHA-256 `515ab49a1049c7804697a3fd267f1edf491d48439d5c06907b3ba0d10e6d6d8b`. El expediente privado conserva la ruta de origen y metadatos; el PDF no se copia al repositorio. El documento identifica la candidata `dass21-spanish-candidate-1.1` y expresa conformidad profesional para administración, scoring, interpretación convencional no diagnóstica y devolución directa dentro de un alcance descrito como estudiantes autorizados de la Facultad de Ingeniería de UPC durante seis meses. La fecha de inicio del periodo no aparece en el registro.

La apariencia de firma, identidad profesional, credencial y autoridad para ese alcance no han sido autenticadas de forma independiente. La constancia no acredita aprobación institucional/ética, consentimiento y tratamiento de datos, ni políticas de retención/acceso o un protocolo operativo de atención. La cláusula de devolución directa entra en conflicto con la guía oficial DASS: UNSW advierte que los puntajes calculados no deben mostrarse a respondientes ni interpretarse automáticamente. Por tanto, la constancia no se registra como autorización de divulgación y `participantDisclosure` permanece `null` hasta que la discrepancia se resuelva formalmente. [FAQ oficial DASS](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

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
| Estado | Evidencia profesional recibida para la versión; autenticidad/alcance pendientes de verificación independiente; sin aprobación institucional/ética, publicación o disponibilidad para participantes |

La página oficial de traducciones de Daza indica que sigue el orden del DASS-21 inglés y remite a la clave. La clave oficial consultada coincide con el mapa y el ×2 del motor. Este cotejo técnico no demuestra pertinencia cultural, validez para la población concreta ni aprobación de la interpretación para este proyecto. [Ficha Daza](https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm), [FAQ UNSW](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

## Implementación real y límites

- El motor, categorizador, resolución `optionId` → `scoringValue`, persistencia interna y lectura transaccional existen como componentes internos.
- La candidata no está cargada en el catálogo y no es seleccionable por el flujo de formularios.
- La composición normal conecta `ScoreCompletedDass21Assessment` al cierre HTTP solo para versiones de una política de servidor por versión exacta; el registro de producción permanece vacío.
- Administración, scoring, soporte interpretativo y divulgación tienen evidencias y decisiones separadas. La constancia es evidencia profesional recibida para administración/scoring/interpretación, pero la vinculación a las implementaciones exactas y su autenticidad/alcance requieren revisión; no hay entradas de autorización productivas registradas. `participantDisclosure` sigue denegado por la discrepancia con la guía oficial.
- `GET /api/v1/preliminary-assessments/:id/result` conserva el contrato histórico sin scores cuando la versión no está registrada. Para una versión registrada, la ruta solo devuelve `{ result: available }` si divulgación y soporte están autorizados; de lo contrario devuelve `{ result: not_available }` sin dimensiones.
- `dass21-participant-result-1.0` y su adaptador están conectados de forma condicional, pero no hay versión disponible en la composición normal actual.
- No hay endpoint de lectura para investigadores/profesionales ni roles de estudio implementados.
- Safety y seguimiento longitudinal real permanecen inactivos.

## Advertencia de la fuente

UNSW indica que los resultados calculados no deben ponerse a disposición de quienes responden y que no se debe intentar interpretación automatizada para ellos, porque puede inducir a error y ser peligrosa. También indica que la interpretación debe realizarla personal con formación adecuada. Para administración en web/app restringida a participantes, UNSW describe la devolución de resultados al profesional/investigador, no al participante. Esta advertencia se conserva y no debe suprimirse de la revisión. [FAQ oficial DASS](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

La evidencia peruana citada por el expediente de 8A.7 estudia 1.163 estudiantes de una universidad pública de Lima; sus resultados no deciden por sí solos la versión exacta, pertinencia para estudiantes de ingeniería de Lima Metropolitana ni la devolución de resultados en este producto. [Cirilo-Acero et al. (2025)](https://www.scielo.org.pe/scielo.php?pid=S1726-46342025000300291&script=sci_arttext).

## Paquete de revisión

1. Revisar la [matriz de decisiones](dass21-authorization-decision-matrix.md); completar responsable identificado, decisión, evidencia, referencia y fecha solo cuando ocurra una revisión real.
2. Evaluar los escenarios y checklists independientes en la [propuesta de divulgación](dass21-results-disclosure-proposal.md).
3. Contrastar el contrato condicionado con la [guía frontend DASS-21](frontend-dass21-results-contract.md). La ruta conserva el estado histórico actual mientras el registro de producción esté vacío.
4. Verificar por un canal institucional la firma, credencial, autoridad y periodo de la constancia; registrar aprobaciones institucionales/éticas y las decisiones pendientes mediante referencias controladas. No agregar nombres, firmas ni aprobaciones supuestas a estos documentos.

## Evidencia técnica de verificación

El Sprint 8A.7 documenta lectura del archivo en Word protegido, hash coincidente, estructura de 21 reactivos y cotejo con plantilla oficial. La implementación candidata y sus pruebas están en `src/modules/preliminary-assessment/domain/model/dass21-spanish-candidate.ts` y `tests/modules/preliminary-assessment/dass21-spanish-candidate.test.ts`.

El contexto del Sprint informa 417 pruebas unitarias y 5/5 pruebas PostgreSQL aprobadas para la lectura transaccional. Esos son antecedentes reportados; este expediente documental no volvió a ejecutar pruebas. No se encontró un documento independiente `sprint-8a5` ni `sprint-8a6`; las garantías 8A.5 se apoyan en el código y test de integración, y el contrato 8A.6 en `docs/frontend-dass21-results-contract.md` y el OpenAPI/código correspondiente.

## Condición actual

La candidata sigue bloqueada para administración con participantes y para disponibilidad normal: no se verificó el UUID de versión ni el hash del conjunto persistido en la base destino; la constancia tiene alcance acotado y autenticidad/autoridad no verificadas; faltan aprobaciones institucionales/éticas y decisiones de consentimiento, privacidad, retención/acceso y protocolo operativo. La devolución permanece bloqueada separadamente. La recepción de la constancia no cambia `not_approved` ni `not_available`.
