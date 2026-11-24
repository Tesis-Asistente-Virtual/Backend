import { describe, expect, it, vi } from 'vitest';
import { OpenAiRecommendationGenerator } from '../../../src/modules/recommendations/infrastructure/openai/openai-recommendation-generator.js';

const settings = {
  openAiApiKey: 'synthetic-test-key', openAiModel: 'synthetic-test-model', openAiTimeoutMs: 7_000,
  openAiMaxOutputTokens: 800, openAiMaxContextMessages: 20, openAiMaxContextCharacters: 24_000,
};
const input = {
  sourceAnalysisVersion: 'conversational-signals-1.0.0',
  eligibleSignals: [{
    dimension: 'anxiety' as const, level: 'moderate' as const, indicators: ['worry'],
    summary: 'Preocupación reiterada en un ejemplo sintético.', observedPattern: 'recurring_across_messages',
    evidence: [{ reference: 'anxiety:0', paraphrase: 'Mencionó preocupación por una evaluación.' }],
  }],
};

describe('OpenAiRecommendationGenerator', () => {
  it('uses structured output, store false, no retries, and only the minimized analysis projection', async () => {
    const parse = vi.fn().mockResolvedValue({
      status: 'completed', error: null,
      output_parsed: { recommendations: [0, 1, 2].map(index => ({
        title: `Sugerencia ${index + 1}`, description: 'Prueba una acción pequeña y voluntaria.',
        dimension: 'anxiety', evidenceReferences: ['anxiety:0'],
      })) },
    });
    const client = { parse } as never;
    const generator = new OpenAiRecommendationGenerator(settings, client);
    const output = await generator.generate(input);
    expect(output.recommendations).toHaveLength(3);
    expect(parse).toHaveBeenCalledOnce();
    const [request, options] = parse.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(900);
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBe(7_000);
    expect(JSON.stringify(request.input)).toContain('anxiety:0');
    expect(JSON.stringify(request.input)).not.toContain('accountId');
    expect(JSON.stringify(request.input)).not.toContain('messageId');
  });

  it('fails closed on invalid structured output', async () => {
    const parse = vi.fn().mockResolvedValue({ status: 'completed', error: null, output_parsed: { recommendations: [] } });
    const generator = new OpenAiRecommendationGenerator(settings, { parse } as never);
    await expect(generator.generate(input)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rejects generated medication or treatment advice', async () => {
    const parse = vi.fn().mockResolvedValue({
      status: 'completed', error: null,
      output_parsed: { recommendations: [0, 1, 2].map(index => ({
        title: `Sugerencia ${index + 1}`,
        description: index === 0 ? 'Solicita un tratamiento para resolver esta situación.' : 'Prueba una acción pequeña y voluntaria.',
        dimension: 'anxiety', evidenceReferences: ['anxiety:0'],
      })) },
    });
    const generator = new OpenAiRecommendationGenerator(settings, { parse } as never);
    await expect(generator.generate(input)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('maps incomplete provider responses without exposing response contents', async () => {
    const parse = vi.fn().mockResolvedValue({ status: 'incomplete', error: null, output_parsed: { private: 'not surfaced' } });
    const generator = new OpenAiRecommendationGenerator(settings, { parse } as never);
    await expect(generator.generate(input)).rejects.toMatchObject({ kind: 'incomplete_response' });
  });
});
