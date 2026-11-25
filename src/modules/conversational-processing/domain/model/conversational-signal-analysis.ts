import { z } from 'zod';

export const conversationalSignalAnalysisVersion = 'conversational-signals-1.1.0' as const;
/** Versión anterior, sin puntuación; los análisis guardados con ella siguen siendo válidos. */
export const legacyConversationalSignalAnalysisVersion = 'conversational-signals-1.0.0' as const;
export const conversationalSignalDimensions = ['depression', 'anxiety', 'stress'] as const;
export const exploratoryEvidenceLevels = ['low', 'moderate', 'high', 'insufficient_evidence'] as const;
export const conversationalSignalIndicators = [
  'low_mood', 'reduced_interest', 'worry', 'anticipatory_worry', 'academic_overload',
  'time_pressure', 'sleep_disruption', 'concentration_difficulty', 'functional_difficulty',
  'physical_tension', 'rumination',
] as const;

const nonDiagnosticText = z.string().trim().min(1).max(500).refine(
  value => !/\b(?:diagn[oó]stico\s+(?:de|es)|diagnosticad[oa]\s+con|padece\s+(?:de\s+)?(?:depresi[oó]n|ansiedad|un\s+trastorno)|tiene\s+(?:depresi[oó]n|ansiedad\s+cl[ií]nica|un\s+trastorno))\b/i.test(value),
  'Use descriptive, non-diagnostic wording',
);

export const conversationalSignalEvidenceSchema = z.object({
  paraphrase: nonDiagnosticText,
  messageId: z.string().uuid(),
}).strict();

export const conversationalDimensionSignalSchema = z.object({
  level: z.enum(exploratoryEvidenceLevels),
  /** Estimación 0 a 3 de la intensidad expresada en los mensajes; null si no hay evidencia suficiente o en análisis anteriores. */
  score: z.number().int().min(0).max(3).nullable(),
  evidenceCount: z.number().int().min(0).max(20),
  indicators: z.array(z.enum(conversationalSignalIndicators)).max(conversationalSignalIndicators.length)
    .refine(items => new Set(items).size === items.length),
  summary: nonDiagnosticText,
  observedPattern: z.enum(['single_report', 'recurring_across_messages', 'context_linked', 'insufficient_evidence']),
  evidence: z.array(conversationalSignalEvidenceSchema).max(20),
}).strict().superRefine((signal, context) => {
  if (signal.level === 'insufficient_evidence' && signal.score !== null) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Insufficient evidence cannot have a score' });
  }
  if (signal.evidenceCount !== signal.evidence.length) {
    context.addIssue({ code: 'custom', path: ['evidenceCount'], message: 'Evidence count must match included message references' });
  }
  if (signal.level === 'insufficient_evidence' && (signal.evidence.length !== 0 || signal.indicators.length !== 0 || signal.observedPattern !== 'insufficient_evidence')) {
    context.addIssue({ code: 'custom', path: ['level'], message: 'Insufficient evidence cannot assert indicators or evidence' });
  }
  if (signal.level !== 'insufficient_evidence' && signal.evidence.length === 0) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'Observed levels require message evidence' });
  }
  const distinctSourceMessages = new Set(signal.evidence.map(item => item.messageId.toLowerCase())).size;
  if (signal.level === 'low' && (distinctSourceMessages !== 1 || signal.observedPattern !== 'single_report')) {
    context.addIssue({ code: 'custom', path: ['level'], message: 'Low evidence is limited to one explicit report' });
  }
  if (signal.level === 'moderate' && distinctSourceMessages < 2 && signal.observedPattern !== 'context_linked') {
    context.addIssue({ code: 'custom', path: ['level'], message: 'Moderate evidence requires multiple messages or an explicit contextual link' });
  }
  if (signal.level === 'high' && (distinctSourceMessages < 3 || signal.observedPattern !== 'recurring_across_messages')) {
    context.addIssue({ code: 'custom', path: ['level'], message: 'High evidence requires explicit repetition across three student messages' });
  }
});

export const conversationalSignalAnalysisPayloadSchema = z.object({
  signals: z.object({
    depression: conversationalDimensionSignalSchema,
    anxiety: conversationalDimensionSignalSchema,
    stress: conversationalDimensionSignalSchema,
  }).strict(),
  overallSummary: nonDiagnosticText,
}).strict();

export const conversationalSignalAnalysisSchema = z.object({
  analysisId: z.string().uuid(),
  conversationId: z.string().uuid(),
  /** Internal ownership field; always omitted from public responses. */
  accountId: z.string().uuid(),
  status: z.literal('available'),
  source: z.literal('conversation_user_messages'),
  analysisVersion: z.enum([legacyConversationalSignalAnalysisVersion, conversationalSignalAnalysisVersion]),
  modelVersion: z.string().trim().min(1).max(100),
  analyzedAt: z.string().datetime(),
  period: z.object({ start: z.string().datetime().nullable(), end: z.string().datetime().nullable() }).strict(),
  coverage: z.object({
    selectedMessageCount: z.number().int().min(1).max(20),
    analyzedUserMessageCount: z.number().int().min(0).max(20),
    excludedNonUserMessageCount: z.number().int().min(0).max(20),
    basis: z.literal('selected_messages_only'),
  }).strict(),
  signals: conversationalSignalAnalysisPayloadSchema.shape.signals,
  overallSummary: nonDiagnosticText,
  suggestedNextStep: z.literal('optional_reflection'),
  reviewStatus: z.literal('not_professionally_reviewed'),
  isDiagnostic: z.literal(false),
  isValidatedClinicalScale: z.literal(false),
  limitations: z.tuple([
    z.literal('textual_observations_only'),
    z.literal('not_a_diagnosis'),
    z.literal('levels_describe_evidence_not_clinical_severity'),
    z.literal('not_a_safety_assessment'),
    z.literal('absence_of_mentions_is_not_evidence_of_absence'),
    z.literal('not_derived_from_dass21'),
    z.literal('not_professionally_reviewed'),
  ]),
}).strict();

export type ConversationalSignalAnalysis = z.infer<typeof conversationalSignalAnalysisSchema>;
export type ConversationalSignalAnalysisPayload = z.infer<typeof conversationalSignalAnalysisPayloadSchema>;

/** Empty evidence is valid for explicit abstention; every supplied reference must still be selected user evidence. */
export function areConversationalSignalEvidenceReferencesValid(
  signals: ConversationalSignalAnalysisPayload['signals'],
  allowedUserMessageIds: readonly string[],
): boolean {
  const allowed = new Set(allowedUserMessageIds.map(id => id.toLowerCase()));
  return conversationalSignalDimensions.every(dimension =>
    signals[dimension].evidence.every(evidence => allowed.has(evidence.messageId.toLowerCase())),
  );
}

export function createConversationalSignalAnalysis(input: {
  analysisId: string;
  conversationId: string;
  accountId: string;
  analyzedAt: Date;
  period: { start: Date | null; end: Date | null };
  selectedMessageCount: number;
  analyzedUserMessageCount: number;
  excludedNonUserMessageCount: number;
  modelVersion: string;
  payload: ConversationalSignalAnalysisPayload;
  allowedUserMessageIds: readonly string[];
}): ConversationalSignalAnalysis {
  if (!areConversationalSignalEvidenceReferencesValid(input.payload.signals, input.allowedUserMessageIds)) {
    throw new Error('Evidence references an unselected or non-user message');
  }
  const periodStart = input.period.start?.toISOString() ?? null;
  const periodEnd = input.period.end?.toISOString() ?? null;
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error('Analysis period is invalid');
  return conversationalSignalAnalysisSchema.parse({
    analysisId: input.analysisId.toLowerCase(), conversationId: input.conversationId.toLowerCase(), accountId: input.accountId.toLowerCase(),
    status: 'available', source: 'conversation_user_messages', analysisVersion: conversationalSignalAnalysisVersion,
    modelVersion: input.modelVersion, analyzedAt: input.analyzedAt.toISOString(),
    period: { start: periodStart, end: periodEnd },
    coverage: {
      selectedMessageCount: input.selectedMessageCount,
      analyzedUserMessageCount: input.analyzedUserMessageCount,
      excludedNonUserMessageCount: input.excludedNonUserMessageCount,
      basis: 'selected_messages_only',
    },
    signals: input.payload.signals, overallSummary: input.payload.overallSummary,
    suggestedNextStep: 'optional_reflection', reviewStatus: 'not_professionally_reviewed',
    isDiagnostic: false, isValidatedClinicalScale: false,
    limitations: [
      'textual_observations_only', 'not_a_diagnosis', 'levels_describe_evidence_not_clinical_severity',
      'not_a_safety_assessment', 'absence_of_mentions_is_not_evidence_of_absence', 'not_derived_from_dass21',
      'not_professionally_reviewed',
    ],
  });
}
