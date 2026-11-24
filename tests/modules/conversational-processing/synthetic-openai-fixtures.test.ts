import { describe, expect, it } from 'vitest';
import {
  classifySyntheticSignalCheckFailure,
  selectSyntheticSignalFixture,
  syntheticOpenAiCheckTimeoutMs,
  syntheticOpenAiMaxOutputTokens,
  syntheticSignalFixtures,
} from '../../../scripts/conversational-signals-openai-fixtures.js';

describe('synthetic conversational signal OpenAI fixture selector', () => {
  it('keeps the existing abstention-oriented fixture as the default', () => {
    expect(selectSyntheticSignalFixture([])).toEqual({ id: 'abstention', fixture: syntheticSignalFixtures.abstention });
    expect(syntheticSignalFixtures.abstention.messages).toHaveLength(1);
  });

  it('uses a bounded one-minute deadline only for the manual synthetic OpenAI check', () => {
    expect(syntheticOpenAiCheckTimeoutMs).toBe(60_000);
  });

  it('uses bounded manual output-token headroom without changing provider defaults', () => {
    expect(syntheticOpenAiMaxOutputTokens).toBe(2_000);
  });

  it('selects a fixed positive synthetic conversation with 6–10 student messages and neutral examples', () => {
    const selected = selectSyntheticSignalFixture(['--fixture=explicit-signals']);
    expect(selected?.id).toBe('explicit-signals');
    expect(selected?.fixture.messages).toHaveLength(8);
    expect(selected?.fixture.messages[2]).toBe('Hoy en clase revisamos un circuito y anoté los valores de una práctica.');
    expect(selected?.fixture.messages[7]).toBe('El fin de semana preparé una receta nueva y salió como esperaba.');
    expect(selected?.fixture.messages.every(message => !message.includes('Ejemplo ficticio') && !message.includes('sin señal'))).toBe(true);
    expect(new Set(selected?.fixture.messages).size).toBe(selected?.fixture.messages.length);
  });

  it('rejects unknown, malformed, or repeated fixture selectors', () => {
    expect(selectSyntheticSignalFixture(['--fixture=other'])).toBeNull();
    expect(selectSyntheticSignalFixture(['--fixture'])).toBeNull();
    expect(selectSyntheticSignalFixture(['--fixture=abstention', '--fixture=explicit-signals'])).toBeNull();
  });

  it('reports safe phase and error type without exposing exception messages or database details', () => {
    const referenceFailure = classifySyntheticSignalCheckFailure(
      new ReferenceError('selectedFixture is not defined; synthetic message content must not appear'),
      'message_setup',
    );
    expect(referenceFailure).toEqual({ phase: 'message_setup', errorKind: 'script_reference_error', errorType: 'ReferenceError' });
    expect(JSON.stringify(referenceFailure)).not.toContain('synthetic message content');

    const databaseFailure = classifySyntheticSignalCheckFailure(
      Object.assign(new Error('connection string and query text must be redacted'), { code: '23505' }),
      'analysis_persistence',
    );
    expect(databaseFailure).toEqual({ phase: 'analysis_persistence', errorKind: 'database_error', errorType: 'Error', sqlState: '23505' });
    expect(JSON.stringify(databaseFailure)).not.toContain('connection string');
  });
});
