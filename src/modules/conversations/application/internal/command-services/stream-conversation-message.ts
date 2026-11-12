import type { ConversationMessage } from '../../../domain/model/conversation-message.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../domain/repositories/conversation-message-repository.js';
import { AiTextGenerationError, type AiTextContextMessage, type AiTextGenerator, type AiTextGenerationRequest, type AiTextStreamEvent } from '../../ports/ai-text-generator.js';
import type { ConversationStreamFailureObservation, ConversationStreamObserver } from '../../ports/conversation-stream-observer.js';
import { noOpConversationStreamObserver } from '../../ports/conversation-stream-observer.js';
import type { ConversationTurnLock } from '../../ports/conversation-turn-lock.js';
import { assistantInstructions } from '../../assistant-instructions.js';
import { MAX_USER_MESSAGE_CHARACTERS, ConversationArchived, InvalidConversationMessage } from './send-conversation-message.js';
import { ConversationNotFound } from '../query-services/get-conversation.js';
import { buildConversationContext } from './build-conversation-context.js';

export type ConversationMessageStreamEvent =
  | { readonly type: 'message.started'; readonly messageId: string }
  | { readonly type: 'message.delta'; readonly text: string }
  | { readonly type: 'message.completed'; readonly messageId: string; readonly status: 'completed' }
  | { readonly type: 'stream.completed' }
  | { readonly type: 'stream.error'; readonly code: 'generation_failed' | 'persistence_failed' };

export interface ConversationMessageStreamCallbacks {
  /** Called only after owner/status checks and the shared PostgreSQL lock succeed. */
  readonly onReady: () => Promise<void>;
  readonly emit: (event: ConversationMessageStreamEvent) => Promise<void>;
}

function generationRequest(messages: readonly AiTextContextMessage[], maxOutputTokens: number): AiTextGenerationRequest {
  return { instructions: assistantInstructions, messages: messages.map(({ role, content }) => ({ role, content })), maxOutputTokens };
}

function providerFailure(error: unknown): { errorKind: ConversationStreamFailureObservation['errorKind']; incompleteReason?: ConversationStreamFailureObservation['incompleteReason'] } {
  if (error instanceof AiTextGenerationError) {
    return { errorKind: error.kind, ...(error.incompleteReason ? { incompleteReason: error.incompleteReason } : {}) };
  }
  return { errorKind: 'unknown' };
}

export class StreamConversationMessage {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: ConversationMessageRepository,
    private readonly generator: AiTextGenerator,
    private readonly turnLock: ConversationTurnLock,
    private readonly maxContextMessages: number,
    private readonly maxOutputTokens: number,
    private readonly observer: ConversationStreamObserver = noOpConversationStreamObserver,
  ) {}

  async execute(accountId: string, conversationId: string, rawContent: string, signal: AbortSignal, callbacks: ConversationMessageStreamCallbacks): Promise<void> {
    const content = rawContent.trim();
    if (!content || content.length > MAX_USER_MESSAGE_CHARACTERS) throw new InvalidConversationMessage();

    await this.turnLock.runExclusive(conversationId, async () => {
      const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
      if (!conversation) throw new ConversationNotFound();
      if (conversation.status !== 'active') throw new ConversationArchived();
      if (signal.aborted) return;

      await callbacks.onReady();
      if (signal.aborted) return;

      const userMessage = await this.messages.createForOwner(accountId, { conversationId, role: 'user', content, status: 'completed' });
      if (!userMessage) throw new ConversationNotFound();
      try {
        await callbacks.emit({ type: 'message.started', messageId: userMessage.id });
      } catch {
        this.report({ operation: 'conversation_stream', stage: 'delta_write', errorKind: signal.aborted ? 'cancelled' : 'transport' });
        await this.persistFailedMessage(accountId, conversationId);
        return;
      }

      let context: AiTextContextMessage[];
      try {
        context = await buildConversationContext(this.messages, conversationId, accountId, userMessage, this.maxContextMessages);
      } catch {
        this.report({ operation: 'conversation_stream', stage: 'context_read', errorKind: 'database' });
        await this.persistFailedMessage(accountId, conversationId);
        await this.emitError(callbacks, signal, 'persistence_failed');
        return;
      }

      const generationAbort = new AbortController();
      const abortForClient = () => generationAbort.abort();
      if (signal.aborted) generationAbort.abort();
      signal.addEventListener('abort', abortForClient, { once: true });

      let iterator: AsyncIterator<AiTextStreamEvent> | undefined;
      let iteratorDone = false;
      let finalText: string | undefined;
      let failure: { errorKind: ConversationStreamFailureObservation['errorKind']; incompleteReason?: ConversationStreamFailureObservation['incompleteReason'] } | undefined;
      try {
        iterator = this.generator.streamText(generationRequest(context, this.maxOutputTokens), generationAbort.signal)[Symbol.asyncIterator]();
        let providerCompleted = false;
        while (true) {
          if (signal.aborted) {
            failure = { errorKind: 'cancelled' };
            break;
          }

          let step: IteratorResult<AiTextStreamEvent>;
          try {
            step = await iterator.next();
          } catch (error) {
            failure = signal.aborted ? { errorKind: 'cancelled' } : providerFailure(error);
            break;
          }
          if (step.done) { iteratorDone = true; break; }

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
            } catch {
              failure = { errorKind: signal.aborted ? 'cancelled' : 'transport' };
              generationAbort.abort();
              break;
            }
          } else {
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
      } catch (error) {
        failure = signal.aborted ? { errorKind: 'cancelled' } : providerFailure(error);
      } finally {
        signal.removeEventListener('abort', abortForClient);
        if (failure && !iteratorDone) {
          generationAbort.abort();
          try { await iterator?.return?.(); } catch { /* Iterator cleanup must not replace the classified failure. */ }
        }
      }

      if (failure) {
        const cancelled = signal.aborted || failure.errorKind === 'cancelled';
        this.report({ operation: 'conversation_stream', stage: cancelled ? 'cancelled' : failure.errorKind === 'transport' ? 'delta_write' : 'provider_stream', ...failure });
        await this.persistFailedMessage(accountId, conversationId);
        if (!cancelled && failure.errorKind !== 'transport') await this.emitError(callbacks, signal, 'generation_failed');
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

      let assistantMessage: ConversationMessage | null;
      try {
        assistantMessage = await this.messages.createForOwner(accountId, { conversationId, role: 'assistant', content: completedText, status: 'completed' });
      } catch {
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
      } catch {
        this.report({ operation: 'conversation_stream', stage: 'completion_write', errorKind: signal.aborted ? 'cancelled' : 'transport' });
      }
    });
  }

  private report(observation: ConversationStreamFailureObservation): void {
    try { this.observer.recordFailure(observation); } catch { /* Logging failure must not affect the turn or lock release. */ }
  }

  private async persistFailedMessage(accountId: string, conversationId: string): Promise<void> {
    try {
      const failedMessage = await this.messages.createForOwner(accountId, { conversationId, role: 'assistant', content: '', status: 'failed' });
      if (!failedMessage) this.report({ operation: 'conversation_stream', stage: 'failure_persistence', errorKind: 'database' });
    } catch {
      this.report({ operation: 'conversation_stream', stage: 'failure_persistence', errorKind: 'database' });
    }
  }

  private async emitError(callbacks: ConversationMessageStreamCallbacks, signal: AbortSignal, code: 'generation_failed' | 'persistence_failed'): Promise<void> {
    if (signal.aborted) return;
    try { await callbacks.emit({ type: 'stream.error', code }); }
    catch { this.report({ operation: 'conversation_stream', stage: 'completion_write', errorKind: 'transport' }); }
  }
}
