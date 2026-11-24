export const syntheticSignalFixtures = {
  abstention: {
    messages: [
      'Ejemplo completamente ficticio: esta semana me he sentido con muchas tareas de la universidad; me preocupa no organizarme antes de una evaluación y he dormido menos por terminar trabajos. No describe a una persona real.',
    ],
  },
  'explicit-signals': {
    messages: [
      'Durante las últimas semanas me cuesta entusiasmarme con actividades que antes esperaba con ganas.',
      'Antes disfrutaba ensayar guitarra, pero últimamente lo dejo para después y casi no me interesa hacerlo.',
      'Hoy en clase revisamos un circuito y anoté los valores de una práctica.',
      'Me preocupa repetidamente desaprobar los próximos exámenes aunque todavía no los he rendido.',
      'Vuelvo a pensar una y otra vez en las evaluaciones y me cuesta dejar esa preocupación cuando termino de estudiar.',
      'Siento que se me juntan las entregas de varios cursos y me cuesta organizar todas esas responsabilidades.',
      'Con esas entregas noto tensión en los hombros y me cuesta relajarme al terminar mis tareas.',
      'El fin de semana preparé una receta nueva y salió como esperaba.',
    ],
  },
} as const;

export type SyntheticSignalFixtureId = keyof typeof syntheticSignalFixtures;
export type SyntheticSignalFixture = (typeof syntheticSignalFixtures)[SyntheticSignalFixtureId];
/** Test-command-only deadline; production OpenAI configuration is not changed. */
export const syntheticOpenAiCheckTimeoutMs = 60_000;
/** Bounded test-only headroom for reasoning plus the three-dimension structured JSON output. */
export const syntheticOpenAiMaxOutputTokens = 2_000;
export const syntheticSignalCheckPhases = [
  'database_identity', 'consent_fixtures', 'synthetic_account_setup', 'consent_setup', 'conversation_setup',
  'message_setup', 'authentication_setup', 'analysis_request', 'openai_call', 'openai_output_validation',
  'analysis_validation', 'analysis_persistence',
  'latest_read', 'history_read', 'final_validation', 'cleanup',
] as const;
export type SyntheticSignalCheckPhase = (typeof syntheticSignalCheckPhases)[number];

const knownErrorKinds = new Set([
  'invalid_input', 'invalid_response', 'provider_unavailable', 'timeout', 'cancelled', 'refusal', 'incomplete_response',
  'non_synthetic_published_notice_blocks_test_fixture', 'synthetic_notice_not_effective', 'synthetic_notice_fixture_conflict',
  'synthetic_notice_fixture_creation_failed', 'synthetic_notice_fixture_publication_failed', 'test_database_identity_mismatch',
  'synthetic_account_setup_failed', 'required_test_consent_notice_missing', 'synthetic_conversation_setup_failed',
  'synthetic_message_setup_failed', 'synthetic_jwt_validation_failed',
  'invalid_input', 'invalid_response', 'provider_unavailable', 'timeout', 'cancelled', 'refusal', 'incomplete_response',
]);
const safeErrorTypes = new Set(['ReferenceError', 'TypeError', 'SyntaxError', 'ZodError', 'DatabaseError', 'Error', 'ConversationalSignalAnalysisError']);

/** Returns bounded diagnostics only; never emits an exception message or provider payload. */
export function classifySyntheticSignalCheckFailure(error: unknown, phase: SyntheticSignalCheckPhase): {
  phase: SyntheticSignalCheckPhase;
  errorKind: string;
  errorType: string;
  sqlState?: string;
} {
  const value = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const name = typeof value.name === 'string' && safeErrorTypes.has(value.name) ? value.name : 'Error';
  const rawKind = typeof value.kind === 'string' && knownErrorKinds.has(value.kind) ? value.kind : undefined;
  const sqlState = typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code) ? value.code : undefined;
  const errorKind = rawKind ?? (name === 'ReferenceError' ? 'script_reference_error' : name === 'ZodError' ? 'schema_validation_failed' : sqlState ? 'database_error' : 'check_failed');
  return { phase, errorKind, errorType: name, ...(sqlState ? { sqlState } : {}) };
}

/** Defaults to the existing abstention-oriented fixture; rejects malformed or repeated selectors. */
export function selectSyntheticSignalFixture(args: readonly string[]): {
  id: SyntheticSignalFixtureId;
  fixture: SyntheticSignalFixture;
} | null {
  const selectors = args.filter(argument => argument === '--fixture' || argument.startsWith('--fixture='));
  if (selectors.length > 1 || selectors.some(selector => selector === '--fixture')) return null;
  const selectedId = selectors[0]?.slice('--fixture='.length);
  if (selectedId !== undefined && selectedId !== 'abstention' && selectedId !== 'explicit-signals') return null;
  const id: SyntheticSignalFixtureId = selectedId ?? 'abstention';
  return { id, fixture: syntheticSignalFixtures[id] };
}
