import { parseConversationSignalExtraction } from '../../application/ports/conversation-signal-extractor.js';
const syntheticReply = 'Esta es una respuesta automática de prueba. Podemos continuar con información ficticia; este entorno no usa un proveedor externo.';
/** Local deterministic provider for integrated staging verification. It never calls a network service. */
export class SyntheticStagingAiAdapters {
    async generateText(_request) {
        return { text: syntheticReply, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    }
    async *streamText(_request, signal) {
        if (signal?.aborted)
            return;
        yield { type: 'delta', text: syntheticReply };
        if (signal?.aborted)
            return;
        yield { type: 'completed', result: { text: syntheticReply, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } };
    }
    async extract(_input, signal) {
        if (signal?.aborted)
            throw new Error('Synthetic extraction cancelled');
        return parseConversationSignalExtraction({
            schemaVersion: '1.0',
            observations: [],
            missingInformation: ['manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact']
                .map(field => ({ field, reason: 'not_assessed' })),
            clarificationQuestions: [],
        });
    }
}
