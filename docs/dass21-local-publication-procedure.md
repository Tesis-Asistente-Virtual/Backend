# Procedimiento local de publicación DASS-21

**Estado actual:** se recibió una constancia profesional fechada 2026-11-23 para `dass21-spanish-candidate-1.1`; su autenticidad/autoridad y alcance no se han verificado de forma independiente y no sustituye aprobaciones institucionales/éticas. La candidata continúa `draft / pending / not_approved`; el registro productivo sigue vacío. La constancia apoya administración, scoring e interpretación dentro del alcance escrito, pero `participantDisclosure` se mantiene `null` porque la devolución individual entra en conflicto con la guía oficial DASS. No se publica ni se habilita para participantes con la evidencia actual. El comando no se ejecutó y no se aplicó su migración en esta revisión.

## Qué hace el comando

`npm run dass21:publish:local` es una operación local fuera de HTTP. No usa `DATABASE_URL` como fallback, no crea instrumentos, no cambia el scoring y no edita la configuración de autorizaciones en código. Por defecto solo valida y hace `ROLLBACK`. La escritura exige `--publish` y confirmar literalmente `base/versionId`.

La conexión se acepta solo si `DASS21_ADMIN_DATABASE_URL` señala PostgreSQL en `localhost`, `127.0.0.1` o `::1`, su base coincide con el manifiesto y el servidor confirma esa identidad. El comando rechaza `NODE_ENV=production`. No ejecuta migraciones; la tabla de auditoría debe haberse instalado previamente mediante el procedimiento de migración aprobado para ese entorno.

## Evidencia requerida

La entrada JSON debe cumplir `dass21PublicationManifestSchema` en `src/modules/preliminary-assessment/application/internal/services/dass21-publication-manifest.ts`. Debe identificar base destino, operador y rol; código, UUID y versión exacta del instrumento; SHA-256 del conjunto de preguntas; decisión de administración; situación y evidencia de licencia; alcance; responsables; fechas; y archivos de evidencia con su hash. La decisión de administración y la licencia son obligatorias para publicar. Scoring, interpretación y divulgación son decisiones separadas y pueden permanecer `null`.

Los documentos deben estar disponibles localmente bajo el workspace y sus hashes deben coincidir. Para no añadir la constancia profesional a Git, `private-approval-evidence/` está ignorado; el borrador privado registra la ruta de origen, hash `515ab49a1049c7804697a3fd267f1edf491d48439d5c06907b3ba0d10e6d6d8b` y decisiones que requieren revisión. El comando comprueba existencia y bytes, no autenticidad, autoridad, validez ética/jurídica ni contenido semántico. Antes de cualquier manifiesto ejecutable, responsables humanos deben verificar la constancia, completar aprobaciones institucionales y resolver las decisiones de la matriz. La ruta de Downloads del borrador no satisface el requisito actual del CLI de evidencia local dentro del workspace. No usar el expediente verbal como evidencia aprobatoria.

La operación vuelve a leer y bloquea la fila exacta, requiere estado `draft / pending`, compara versión y huella de las 21 preguntas ordenadas, valida el modelo de dominio y, si se autoriza scoring, exige un mapeo congelado completo para esa versión. La transición de catálogo y el registro append-only en `dass21_version_publication_audit` se confirman en una sola transacción. Una segunda publicación de la misma versión se rechaza.

## Secuencia operativa futura

1. Completar las decisiones aplicables de [la matriz profesional](dass21-authorization-decision-matrix.md) con referencias y fechas reales. Mantener divulgación al participante pendiente salvo decisión independiente y explícita.
2. Preparar el manifiesto para la base y versión exactas; incluir archivos de revisión/licencia y hashes verificables. El hash de preguntas debe corresponder al catálogo que se revisó.
3. Aplicar la migración `0011_dass21_publication_audit.sql` a la base autorizada mediante el flujo de migraciones revisado. El comando de publicación no migra.
4. En una sesión local autorizada, configurar `DASS21_ADMIN_DATABASE_URL` para esa base loopback. Ejecutar primero el modo de validación:

   ```powershell
   npm run dass21:publish:local -- --manifest docs/dass21-publication-manifest.json
   ```

5. Revisar que no haya advertencias, que la versión y hash sean exactos y que los alcances correspondan a los documentos. Para publicar, ejecutar con confirmación exacta:

   ```powershell
   npm run dass21:publish:local -- --manifest docs/dass21-publication-manifest.json --publish --confirm 'DB_NAME/INSTRUMENT_VERSION_UUID'
   ```

   Sustituir base y UUID solo por los valores autorizados y verificados. No ejecutar este comando ahora: no hay evidencia de aprobación adjunta y no se ha autorizado escribir en una base.

6. El comando imprime la entrada de autorización correspondiente al registro de servidor. Un cambio de código revisado debe añadir únicamente las decisiones concedidas a `productionDass21VersionAuthorizations`. Sin esa entrada, el catálogo normal mantiene DASS-21 bloqueado aunque la fila esté publicada. Para scoring hacen falta el mapeo y la autorización de scoring; interpretación y divulgación se registran aparte.
7. Tras desplegar la configuración revisada, verificar `/api/v1/preliminary-assessments/info`, completar una evaluación sintética autorizada y consultar `/result`. Sin divulgación autorizada, `/result` no incluye dimensiones. Ninguna de estas verificaciones equivale a permiso de piloto.

## Auditoría y bloqueo

La auditoría registra versión exacta, hash de preguntas, operador/rol, conjunto de decisiones y fecha. La tabla impide `UPDATE` y `DELETE` mediante trigger. No almacena el contenido de las preguntas ni las respuestas de participantes.

Para bloquear una versión ya publicada, retirar su entrada exacta del registro del servidor y desplegar el cambio: desaparece de la disponibilidad normal, no se dispara scoring nuevo y `/result` vuelve al contrato histórico sin puntajes. Esto no elimina scores ya persistidos ni registra hoy un evento de revocación separado; ambos puntos requieren política y operación de datos específica antes de un uso real.

## Límites pendientes

- El comando no autentica por sí mismo las firmas o autoridad de los documentos; requiere revisión humana independiente.
- Hay un borrador privado incompleto, no ejecutable; no es una entrada de autorización ni un manifiesto publicable. No se publicó la candidata ni se habilitó scoring o divulgación en producción.
- La matriz vigente mantiene pendientes las decisiones profesionales, institucionales, de licencia, consentimiento, retención y devolución.
- La migración es aditiva y está pendiente de revisión/aplicación autorizada.
