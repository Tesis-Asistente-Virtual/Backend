import { z } from 'zod';
import { conversationalSignalDimensions } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';

export const recommendationGenerationOutputSchema = z.object({
  recommendations: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    dimension: z.enum(conversationalSignalDimensions),
    evidenceReferences: z.array(z.string().trim().min(1).max(32)).min(1).max(5),
  }).strict()).min(3).max(5),
}).strict().superRefine((value, context) => {
  const clinicalAdvicePattern = /\b(medicaci[oó]n|medicamento|f[aá]rmaco|tratamiento|diagn[oó]stico|diagnosticar|terapia|terap[eé]utico|dosis|prescribir|prescripci[oó]n|cl[ií]nico)\b/i;
  value.recommendations.forEach((item, index) => {
    if (clinicalAdvicePattern.test(`${item.title} ${item.description}`)) {
      context.addIssue({ code: 'custom', path: ['recommendations', index], message: 'Recommendations must not contain clinical advice' });
    }
  });
  const titles = value.recommendations.map(item => item.title.toLocaleLowerCase());
  if (new Set(titles).size !== titles.length) {
    context.addIssue({ code: 'custom', path: ['recommendations'], message: 'Recommendation titles must be unique' });
  }
});

export type RecommendationGenerationOutput = z.infer<typeof recommendationGenerationOutputSchema>;
export type RecommendationGenerationInput = {
  readonly sourceAnalysisVersion: string;
  readonly eligibleSignals: ReadonlyArray<{
    readonly dimension: typeof conversationalSignalDimensions[number];
    readonly level: 'low' | 'moderate';
    readonly indicators: readonly string[];
    readonly summary: string;
    readonly observedPattern: string;
    readonly evidence: ReadonlyArray<{ readonly reference: string; readonly paraphrase: string }>;
  }>;
};

export class RecommendationGenerationError extends Error {
  constructor(readonly kind: 'unavailable' | 'timeout' | 'cancelled' | 'invalid_response' | 'incomplete_response') {
    super('Recommendation generation failed');
    this.name = 'RecommendationGenerationError';
  }
}

export interface RecommendationGenerator {
  readonly modelVersion: string;
  generate(input: RecommendationGenerationInput, signal?: AbortSignal): Promise<RecommendationGenerationOutput>;
}
