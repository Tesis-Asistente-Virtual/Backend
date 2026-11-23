import { AiTextGenerationError } from '../../ports/ai-text-generator.js';
import { noOpConversationStreamObserver } from '../../ports/conversation-stream-observer.js';
import { assistantInstructions } from '../../assistant-instructions.js';
import { MAX_USER_MESSAGE_CHARACTERS, ConversationArchived, InvalidConversationMessage } from './send-conversation-message.js';
import { ConversationNotFound } from '../query-services/get-conversation.js';
import { buildConversationContext } from './build-conversation-context.js';
import { ConversationProcessingConsentError, requireConversationProcessingConsent } from '../../ports/conversation-processing-consent.js';
function generationRequest(messages, maxOutputTokens) {
    return { instructions: assistantInstructions, messages: messages.map(({ role, content }) => ({ role, content })), maxOutputTokens };
}
function providerFailure(error) {
    if (error instanceof AiTextGenerationError) {
        return {
            errorKind: error.kind,
            ...(error.incompleteReason ? { incompleteReason: error.incompleteReason } : {}),
            ...(error.failureStage ? { failureStage: error.failureStage } : {}),
        };
    }
    return { errorKind: 'unknown' };
}
export class StreamConversationMessage {
    conversations;
    messages;
    generator;
    turnLock;
    maxContextMessages;
    maxOutputTokens;
    consent;
    observer;
    constructor(conversations, messages, generator, turnLock, maxContextMessages, maxOutputTokens, consent, observer = noOpConversationStreamObserver) {
        this.conversations = conversations;
        this.messages = messages;
        this.generator = generator;
        this.turnLock = turnLock;
        this.maxContextMessages = maxContextMessages;
        this.maxOutputTokens = maxOutputTokens;
        this.consent = consent;
        this.observer = observer;
    }
    async execute(accountId, conversationId, rawContent, signal, callbacks) {
        const content = rawContent.trim();
        if (!content || content.length > MAX_USER_MESSAGE_CHARACTERS)
            throw new InvalidConversationMessage();
        await this.turnLock.runExclusive(conversationId, async () => {
            const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
            if (!conversation)
                throw new ConversationNotFound();
            if (conversation.status !== 'active')
                throw new ConversationArchived();
            if (signal.aborted)
                return;
            // Denials here remain ordinary HTTP responses because SSE headers are not sent yet.
            await requireConversationProcessingConsent(this.consent, accountId);
            await callbacks.onReady();
            if (signal.aborted)
                return;
            let userMessage;
            try {
                // The repository rechecks the exact current published notice and latest decision
                // in a short transaction serialized with consent decisions.
                userMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, { conversationId, role: 'user', content, status: 'completed' });
            }
            catch (error) {
                if (error instanceof ConversationProcessingConsentError) {
                    await this.emitError(callbacks, signal, error.code);
                    return;
                }
                throw error;
            }
            if (!userMessage)
                throw new ConversationNotFound();
            try {
                await callbacks.emit({ type: 'message.started', messageId: userMessage.id });
            }
            catch {
                this.report({ operation: 'conversation_stream', stage: 'delta_write', errorKind: signal.aborted ? 'cancelled' : 'transport' });
                await this.persistFailedMessage(accountId, conversationId);
                return;
            }
            let context;
            try {
                context = await buildConversationContext(this.messages, conversationId, accountId, userMessage, this.maxContextMessages);
            }
            catch {
                this.report({ operation: 'conversation_stream', stage: 'context_read', errorKind: 'database' });
                await this.persistFailedMessage(accountId, conversationId);
                await this.emitError(callbacks, signal, 'persistence_failed');
                return;
            }
            // Do not disclose context if consent was withdrawn while the context was loaded.
            try {
                await requireConversationProcessingConsent(this.consent, accountId);
            }
            catch (error) {
                const code = error instanceof ConversationProcessingConsentError ? error.code : 'consent_unavailable';
                await this.emitError(callbacks, signal, code);
                return;
            }
            const generationAbort = new AbortController();
            const abortForClient = () => generationAbort.abort();
            if (signal.aborted)
                generationAbort.abort();
            signal.addEventListener('abort', abortForClient, { once: true });
            let iterator;
            let iteratorDone = false;
            let finalText;
            let failure;
            try {
                iterator = this.generator.streamText(generationRequest(context, this.maxOutputTokens), generationAbort.signal)[Symbol.asyncIterator]();
                let providerCompleted = false;
                while (true) {
                    if (signal.aborted) {
                        failure = { errorKind: 'cancelled' };
                        break;
                    }
                    let step;
                    try {
                        step = await iterator.next();
                    }
                    catch (error) {
                        failure = signal.aborted ? { errorKind: 'cancelled' } : providerFailure(error);
                        break;
                    }
                    if (step.done) {
                        iteratorDone = true;
                        break;
                    }
                    const event = step.value;
                    if (event.type === 'delta') {
                        if (providerCompleted) {
                            failure = { errorKind: 'invalid_response' };
                            break;
                        }
                        if (signal.aborted) {
                            failure = { errorKind: 'cancelled' };
                            break;
                        }
                        try {
                            await callbacks.emit({ type: 'message.delta', text: event.text });
                        }
                        catch {
                            failure = { errorKind: signal.aborted ? 'cancelled' : 'transport' };
                            generationAbort.abort();
                            break;
                        }
                    }
                    else {
                        if (providerCompleted) {
                            failure = { errorKind: 'invalid_response' };
                            break;
                        }
                        providerCompleted = true;
                        finalText = event.result.text.trim();
                    }
                }
                if (!failure && (!providerCompleted || !finalText)) {
                    failure = { errorKind: finalText === '' ? 'empty_response' : 'incomplete_response' };
                }
            }
            catch (error) {
                failure = signal.aborted ? { errorKind: 'cancelled' } : providerFailure(error);
            }
            finally {
                signal.removeEventListener('abort', abortForClient);
                if (failure && !iteratorDone) {
                    generationAbort.abort();
                    try {
                        await iterator?.return?.();
                    }
                    catch { /* Iterator cleanup must not replace the classified failure. */ }
                }
            }
            if (failure) {
                const cancelled = signal.aborted || failure.errorKind === 'cancelled';
                const stage = cancelled ? 'cancelled'
                    : failure.errorKind === 'transport' ? 'delta_write'
                        : failure.failureStage ?? 'provider_stream';
                this.report({
                    operation: 'conversation_stream', stage, errorKind: failure.errorKind,
                    ...(failure.incompleteReason ? { incompleteReason: failure.incompleteReason } : {}),
                });
                await this.persistFailedMessage(accountId, conversationId);
                if (!cancelled && failure.errorKind !== 'transport')
                    await this.emitError(callbacks, signal, 'generation_failed');
                return;
            }
            if (signal.aborted) {
                this.report({ operation: 'conversation_stream', stage: 'cancelled', errorKind: 'cancelled' });
                await this.persistFailedMessage(accountId, conversationId);
                return;
            }
            const completedText = finalText;
            if (!completedText) {
                this.report({ operation: 'conversation_stream', stage: 'provider_stream', errorKind: 'empty_response' });
                await this.persistFailedMessage(accountId, conversationId);
                await this.emitError(callbacks, signal, 'generation_failed');
                return;
            }
            let assistantMessage;
            try {
                assistantMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, { conversationId, role: 'assistant', content: completedText, status: 'completed' });
            }
            catch (error) {
                if (error instanceof ConversationProcessingConsentError) {
                    await this.emitError(callbacks, signal, error.code);
                    return;
                }
                this.report({ operation: 'conversation_stream', stage: 'assistant_persistence', errorKind: 'database' });
                await this.emitError(callbacks, signal, 'persistence_failed');
                return;
            }
            if (!assistantMessage) {
                this.report({ operation: 'conversation_stream', stage: 'assistant_persistence', errorKind: 'database' });
                await this.emitError(callbacks, signal, 'persistence_failed');
                return;
            }
            try {
                await callbacks.emit({ type: 'message.completed', messageId: assistantMessage.id, status: 'completed' });
                await callbacks.emit({ type: 'stream.completed' });
            }
            catch {
                this.report({ operation: 'conversation_stream', stage: 'completion_write', errorKind: signal.aborted ? 'cancelled' : 'transport' });
            }
        });
    }
    report(observation) {
        try {
            this.observer.recordFailure(observation);
        }
        catch { /* Logging failure must not affect the turn or lock release. */ }
    }
    async persistFailedMessage(accountId, conversationId) {
        try {
            const failedMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, { conversationId, role: 'assistant', content: '', status: 'failed' });
            if (!failedMessage)
                this.report({ operation: 'conversation_stream', stage: 'failure_persistence', errorKind: 'database' });
        }
        catch {
            this.report({ operation: 'conversation_stream', stage: 'failure_persistence', errorKind: 'database' });
        }
    }
    async emitError(callbacks, signal, code) {
        if (signal.aborted)
            return;
        try {
            await callbacks.emit({ type: 'stream.error', code });
        }
        catch {
            this.report({ operation: 'conversation_stream', stage: 'completion_write', errorKind: 'transport' });
        }
    }
}
