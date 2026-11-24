import { describe, expect, it, vi } from 'vitest';
import { RecommendationsController } from '../../../src/modules/recommendations/interfaces/rest/recommendations-controller.js';
import { RecommendationsUnavailable } from '../../../src/modules/recommendations/application/recommendation-errors.js';

function fakeResponse() {
  const response = { statusCode: 0, body: undefined as unknown, writableEnded: false, destroyed: false,
    once() { return this; }, off() { return this; },
    status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return response;
}
function fakeRequest(body: unknown) {
  return { auth: { accountId: '550e8400-e29b-41d4-a716-446655440001' }, body, aborted: false, once() { return this; }, off() { return this; } };
}

describe('RecommendationsController', () => {
  it('uses only the authenticated account context and returns generated cards', async () => {
    const service = {
      generate: vi.fn(async (accountId: string) => ({
        created: true,
        recommendations: {
          contractVersion: 'wellbeing-recommendations-1.0', recommendationSetId: '550e8400-e29b-41d4-a716-446655440030',
          status: 'available', sourceAnalysisId: '550e8400-e29b-41d4-a716-446655440010',
          generatedAt: '2026-11-24T12:00:00.000Z', expiresAt: '2027-02-22T12:00:00.000Z',
          recommendations: [0, 1, 2].map(index => ({
            id: `550e8400-e29b-41d4-a716-44665544003${index + 1}`, kind: 'general', title: `Card ${index}`,
            description: 'Sugerencia sintética.', dimension: null, justification: 'Orientación general.',
            sourceAnalysisId: '550e8400-e29b-41d4-a716-446655440010', evidenceReferences: [],
          })),
          professionalSupportNotice: null, isDiagnostic: false, isClinicalAdvice: false,
          limitations: ['exploratory_conversational_evidence_only', 'not_a_diagnosis_or_clinical_assessment', 'not_a_crisis_detector', 'not_a_substitute_for_professional_care', 'generated_from_persisted_analysis_not_messages'],
        },
      })),
      latest: vi.fn(),
    };
    const controller = new RecommendationsController(service);
    const response = fakeResponse();
    await controller.generate(fakeRequest({}) as never, response as never);
    expect(response.statusCode).toBe(201);
    expect(service.generate).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001', {}, expect.any(AbortSignal));
  });

  it('rejects client-supplied identity, levels, or other reserved body fields', async () => {
    const controller = new RecommendationsController({ generate: vi.fn(), latest: vi.fn() } as never);
    await expect(controller.generate(fakeRequest({ accountId: '550e8400-e29b-41d4-a716-446655440099', level: 'high' }) as never, fakeResponse() as never)).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('fails closed if the production service is not composed', async () => {
    const controller = new RecommendationsController(null);
    await expect(controller.latest(fakeRequest(undefined) as never, fakeResponse() as never)).rejects.toBeInstanceOf(RecommendationsUnavailable);
  });
});
