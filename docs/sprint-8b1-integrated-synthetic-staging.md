# Sprint 8B.1 — staging integrado sintético

## Estado

Se preparó un entrypoint independiente para integrar autenticación, consentimientos, conversación sintética, extracción explícita y evaluación DASS-21 técnica. No está montado en `src/app.ts`, `src/server.ts`, `npm run dev` ni `npm start`. Solo escucha en `127.0.0.1`; el arranque rechaza `NODE_ENV=production`.

La candidata continúa `dass21-spanish-candidate-1.1`, `draft / pending / not_approved`. La disponibilidad técnica restringida no significa aprobación profesional, clínica, ética, institucional ni autorización para un piloto con personas. La conformidad verbal mencionada para el proyecto no se registra como aprobación formal.

**No se configuró ni conectó una base de staging durante este incremento.** En el entorno de trabajo no están definidas `STAGING_DATABASE_URL` ni `TEST_DATABASE_URL`; por ello, no se ejecutaron migraciones, seeders ni pruebas PostgreSQL.

## Composición y separación

`src/staging/create-integrated-synthetic-staging-app.ts` compone casos de uso existentes con una conexión Drizzle y un JWT inyectados. La configuración de base viene exclusivamente de `STAGING_DATABASE_URL`; no hay fallback a `DATABASE_URL`, `TEST_DATABASE_URL` ni `DEMO_DATABASE_URL`. Se valida el nombre exacto `tesis_staging_db`, protocolo PostgreSQL y host loopback, y luego se verifica la identidad real de la conexión antes de cualquier escritura de fixture.

El entrypoint tiene guardas adicionales:

- `STAGING_JWT_SECRET` debe estar definido y tener al menos 32 bytes. No usa el secreto normal como fallback.
- Solo acepta registros e inicios de sesión del dominio reservado `example.test`.
- El chat solo acepta el título de prueba y un mensaje sintético fijo; el generador y el extractor son deterministas y locales, sin OpenAI ni otro proveedor externo.
- La extracción sintética devuelve cero observaciones reportadas y marca los campos como `not_assessed`; no afirma que haya señales presentes o ausentes.
- Las decisiones de consentimiento son independientes para `ai_conversation_processing`, `structured_signal_extraction` y `preliminary_assessment`. No se monta `longitudinal_monitoring`.
- DASS-21 reutiliza el caso de uso de PreliminaryAssessment, scoring, categorizador, lector transaccional y adaptador técnico existentes. El instrumento normal continúa sujeto a la política global `approved`; solo el router de esta composición admite el UUID fijo del candidato con sus estados pendientes.
- No se montan Safety, endpoints longitudinales ni las rutas normales que importan la conexión global.

Los avisos de staging son fixtures ficticios separados, marcados `SOLO PRUEBA TÉCNICA / NO APROBACIÓN LEGAL / DATOS FICTICIOS`. El cargador es explícito, transaccional e idempotente; si hay avisos publicados incompatibles, se detiene sin reemplazarlos. No constituye aviso jurídico ni autorización para participantes.

## Preparación local explícita

Estos comandos son instrucciones para el operador. No fueron ejecutados por Codex y no crean credenciales ni modifican `.env`.

```powershell
# Crear la base manualmente en la instancia PostgreSQL local autorizada.
createdb tesis_staging_db

# Configurar solo para esta sesión de PowerShell; sustituir por credenciales
# locales ya existentes. No reutilizar DATABASE_URL ni guardar esto en .env.
$env:STAGING_DATABASE_URL = 'postgres://<usuario>:<clave>@localhost:5432/tesis_staging_db'
$env:STAGING_JWT_SECRET = '<secreto local aleatorio de al menos 32 bytes>'
$env:NODE_ENV = 'development'

# Opcional. Sin esta variable CORS no concede acceso cross-origin.
$env:STAGING_CORS_ALLOWED_ORIGINS = 'http://localhost:5173'

# Aplicar las migraciones versionadas únicamente a tesis_staging_db.
npm run db:migrate:staging

# Crear los tres avisos ficticios. El comando vuelve a comprobar host y base.
npm run staging:seed-synthetic-consents

# Iniciar el servidor aislado; detenerlo con Ctrl+C.
npm run staging:integrated:synthetic
```

`STAGING_DATABASE_URL` debe incluir usuario y contraseña, usar `postgres:` o `postgresql:`, no contener query/hash, y apuntar a `tesis_staging_db` en `localhost`, `127.0.0.1` o `::1`. El proceso vuelve a verificar `current_database()` y la dirección del servidor PostgreSQL. Los scripts de migración y avisos también hacen esa comprobación. La base no se crea automáticamente.

El servidor escucha en `http://127.0.0.1:3042` por defecto (`STAGING_PORT` permite escoger otro puerto local). `STAGING_CORS_ALLOWED_ORIGINS`, si se define, debe ser una lista separada por comas de orígenes HTTP(S) exactos, sin `*`; CORS vacío deniega cross-origin. En esta versión el backend solo es accesible desde el mismo host: no se configura bind a interfaces de red ni staging remoto.

Para apagar, usar `Ctrl+C` o enviar `SIGTERM`. El cierre deja terminar el servidor y libera el pool. No se elimina automáticamente la base, cuentas, avisos ni evaluaciones; son datos de la base local dedicada. El operador debe mantenerla como entorno sintético y seguir la política local de limpieza autorizada.

## Flujo HTTP realmente compuesto

Base URL local: `http://127.0.0.1:3042`. Todas las rutas, salvo `/health` y consulta de avisos, requieren JWT donde lo hace el contrato original. No se acepta `accountId` del cliente.

1. `POST /api/v1/auth/sign-up` recibe `{"email":"demo-01@example.test","password":"<mínimo 12 caracteres>"}` y devuelve `201` con `id`, `email`, `message`. El registro no inicia sesión.
2. `POST /api/v1/auth/sign-in` recibe el mismo email y contraseña y devuelve `accessToken`, `refreshToken`, `tokenType` y `expiresIn`. Enviar `Authorization: Bearer <accessToken>` en las llamadas protegidas. Refresh y sign-out reutilizan `/api/v1/auth/refresh` y `/api/v1/auth/sign-out`.
3. `GET /api/v1/consents/notices` devuelve `[{id,purpose,version,content,effectiveAt}]`. `POST /api/v1/consents/me/decisions` registra una decisión explícita usando el contrato actual: `{"purpose":"ai_conversation_processing","noticeVersionId":"<UUID vigente>","action":"granted","idempotencyKey":"<UUID nuevo>"}`. Repetir para extracción y evaluación con el ID/versionado correspondiente. `GET /api/v1/consents/me` permite consultar el estado. El retiro y rechazo conservan el bloqueo de operaciones exigido por cada caso de uso.
4. Chat: `POST /api/v1/conversations` con `{}` o título fijo `{"title":"Prueba sintética de conversación"}`. El título puede omitirse. Para enviar un turno, `POST /api/v1/conversations/{id}/messages` o `POST /api/v1/conversations/{id}/messages/stream` con el único contenido admitido:

   ```json
   {"content":"[SINTÉTICO] Me cuesta organizarme para mis exámenes y quiero conversar sobre manejo del tiempo."}
   ```

   El POST normal responde con `userMessage` y `assistantMessage`. El POST SSE conserva los eventos existentes (`message.started`, `message.delta`, `message.completed`, `stream.error`). Mensajes distintos se rechazan con `400` antes de persistirlos. Las rutas de lectura de conversación siguen comprobando propiedad.
5. Extracción/resultados: con consentimientos de conversación y extracción vigentes, `POST /api/v1/conversations/{id}/signals/extract` o `/signals/results` recibe `{"messageIds":["<UUID de mensaje seleccionado>"]}`. El extractor falso retorna de forma determinista una colección vacía y datos `not_assessed`; `signals/results` conserva la forma de `preliminaryGuidance`, es efímero y no produce evidencia clínica.
6. Cuestionario: `GET /api/v1/preliminary-assessments/info` lista el candidato en esta composición; `POST /api/v1/preliminary-assessments` recibe `{"instrumentVersionId":"00000000-0000-4000-8000-000000008a92"}`. Obtener el formulario con `GET /api/v1/preliminary-assessments/{id}/form`. Debe informar que está disponible solo para prueba técnica, con revisión pendiente y aprobación no concedida.
7. Responder cada uno de los 21 reactivos por separado con `POST /api/v1/preliminary-assessments/{id}/responses`: `{"questionId":"<UUID del formulario>","answer":{"type":"single_choice","optionId":"<optionId devuelto para esa pregunta>"}}`. El servidor resuelve el valor 0–3 de la definición versionada; el cliente no envía `scoringValue`.
8. Finalizar con `POST /api/v1/preliminary-assessments/{id}/complete` y cuerpo `{}`. El scoring determinista se ejecuta después de completar y permanece asociado a la evaluación. `GET /api/v1/preliminary-assessments/{id}/result` devuelve el resultado técnico envuelto en `technicalTest` y `result`, solo al propietario con autorización vigente.

Para el esquema completo del resultado, dimensiones, categorías y limitaciones, usar como referencia técnica el ejemplo ya verificado en [sprint-8a9b-dass21-technical-test.md](sprint-8a9b-dass21-technical-test.md). Es un contrato de test sintético, no disponible en la aplicación normal ni una respuesta autorizada para participantes. El endpoint normal de resultado conserva su contrato `not_available` sin scores.

## Qué comparte y qué permanece separado

La misma cuenta ficticia `@example.test` puede aceptar propósitos separados y utilizar ambos flujos. Compartir identidad no hace que el consentimiento de chat autorice DASS-21, ni que el consentimiento de evaluación autorice extracción. El DASS se responde mediante formulario estructurado; no lee mensajes ni `preliminaryGuidance`. Los resultados de chat no reciben puntuaciones. DASS requiere 21 respuestas completas, propiedad, versión exacta y consentimiento vigente.

No se habilitan usuarios reales, frontend remoto, OpenAI, Safety, monitoreo longitudinal, interpretación clínica ni publicación normal de resultados. No hay evidencias de aprobación escrita, institucional o profesional para el piloto. Antes de cualquier piloto se requieren esas decisiones humanas y una política aprobada de consentimiento, administración digital, acceso, retención, devolución y atención de situaciones sensibles.

## Verificación

Ejecutado en este incremento:

- `npm run typecheck` — aprobado.
- `npm run build` — aprobado.
- `npm test` — 431 pruebas aprobadas en 52 archivos.

PostgreSQL no se ejecutó: `STAGING_DATABASE_URL` y `TEST_DATABASE_URL` no estaban configuradas. Después de preparar la base local y aplicar las migraciones, la suite existente DASS puede repetirse con `npx vitest run tests/integration/dass21-technical-test.integration.test.ts`. La composición integrada aún requiere una prueba end-to-end local contra `tesis_staging_db`; no se presenta como validada hasta que esa verificación se ejecute.

La integración del backend quedó implementada; la prueba funcional completa de staging y la configuración del host local autorizado permanecen pendientes.
