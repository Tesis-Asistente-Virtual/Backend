import { randomUUID } from 'node:crypto';
import { OpenAiConfigurationError } from '../src/modules/conversations/infrastructure/openai/openai-configuration.js';
import { ConversationSignalExtractionError, parseConversationSignalExtraction } from '../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import { OpenAiConversationSignalExtractor } from '../src/modules/conversational-processing/infrastructure/openai/openai-conversation-signal-extractor.js';

const args = process.argv.slice(2);
const confirmationFlag = '--allow-real-openai';

function printUsage(): void {
  process.stdout.write(
    'Manual OpenAI extraction check. No provider call was made.\n' +
    'Run explicitly with: npm run manual:test-signal-extraction -- --allow-real-openai\n',
  );
}

if (args.length !== 1 || args[0] !== confirmationFlag) {
  printUsage();
} else {
  const cases = [
    {
      name: 'A',
      content: 'Estoy cansado por los exámenes y últimamente me cuesta dormir.',
    },
    {
      name: 'B',
      content: 'Desde hace varias semanas he perdido interés en actividades que antes disfrutaba y me cuesta concentrarme.',
    },
    {
      name: 'C',
      content: 'Hoy tuve clases y terminé mis trabajos pendientes.',
    },
  ] as const;

  function safeErrorCategory(error: unknown): string {
    if (error instanceof ConversationSignalExtractionError) return error.kind;
    if (error instanceof OpenAiConfigurationError) return 'provider_unavailable';
    return 'provider_unavailable';
  }

  async function run(): Promise<void> {
    let extractor: OpenAiConversationSignalExtractor;
    try {
      extractor = new OpenAiConversationSignalExtractor();
    } catch (error) {
      if (error instanceof OpenAiConfigurationError) {
        process.stderr.write('Manual extraction unavailable: configure OPENAI_API_KEY and OPENAI_MODEL before running.\n');
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`Manual extraction unavailable: ${safeErrorCategory(error)}.\n`);
      process.exitCode = 1;
      return;
    }

    let allCasesValid = true;
    for (const testCase of cases) {
      const messageId = randomUUID();
      try {
        const result = await extractor.extract({
          messages: [{ messageId, role: 'user', content: testCase.content }],
        });
        const validated = parseConversationSignalExtraction(result);
        const suppliedReferences = new Set<string>([messageId]);
        const referencesValid = validated.observations.every(observation =>
          observation.sourceMessageIds.every(reference => suppliedReferences.has(reference)),
        );
        if (!referencesValid) throw new ConversationSignalExtractionError('invalid_response');

        process.stdout.write(`${JSON.stringify({
          case: testCase.name,
          validation: 'passed',
          zod: 'valid',
          observationCount: validated.observations.length,
          requiredFieldsPresent: true,
          sourceReferencesValid: true,
        })}\n`);
      } catch (error) {
        allCasesValid = false;
        process.stderr.write(`${JSON.stringify({
          case: testCase.name,
          validation: 'failed',
          errorCategory: safeErrorCategory(error),
        })}\n`);
      }
    }

    if (!allCasesValid) process.exitCode = 1;
  }

  void run().catch(error => {
    process.stderr.write(`${JSON.stringify({ validation: 'failed', errorCategory: safeErrorCategory(error) })}\n`);
    process.exitCode = 1;
  });
}
