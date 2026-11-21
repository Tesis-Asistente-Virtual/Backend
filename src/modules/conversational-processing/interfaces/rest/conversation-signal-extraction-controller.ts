import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { conversationSignalExtractionSchema, type ConversationSignalExtraction } from '../../domain/model/signal-observation.js';
import { createConversationSignalResult, conversationSignalResultSchema } from '../../domain/model/conversation-signal-result.js';
import { SignalExtractionUnavailable } from '../../application/internal/command-services/extract-authorized-conversation-signals.js';
import { signalExtractorVersion } from '../../application/signal-extraction-instructions.js';
import { conversationIdParamsSchema } from '../../../conversations/interfaces/rest/validation/conversation-request-schemas.js';

export interface ConversationSignalExtractionService {
  execute(accountId: string, input: unknown, signal?: AbortSignal): Promise<ConversationSignalExtraction>;
}

export const extractConversationSignalsRequestSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
}).strict();

export const extractConversationSignalsResponseSchema = conversationSignalExtractionSchema.extend({
  status: z.literal('completed'),
}).strict();

export const generateConversationSignalResultResponseSchema = conversationSignalResultSchema.omit({ accountId: true }).extend({
  status: z.literal('completed'),
}).strict();

export class ConversationSignalExtractionController {
  constructor(private readonly extraction: ConversationSignalExtractionService | null) {}

  async execute(req: Request, res: Response): Promise<void> {
    const completed = await this.extract(req, res);
    if (!completed) return;
    res.status(200).json(extractConversationSignalsResponseSchema.parse({ status: 'completed', ...completed.extraction }));
  }

  async generateResult(req: Request, res: Response): Promise<void> {
    const completed = await this.extract(req, res);
    if (!completed) return;
    const transientResult = createConversationSignalResult({
      id: randomUUID(),
      conversationId: completed.conversationId,
      accountId: completed.accountId,
      generatedAt: new Date(),
      extractorVersion: signalExtractorVersion,
      sourceMessageIds: completed.messageIds,
      extraction: completed.extraction,
    });
    const { accountId: _ownerAccountId, ...publicResult } = transientResult;
    res.status(200).json(generateConversationSignalResultResponseSchema.parse({ status: 'completed', ...publicResult }));
  }

  private async extract(req: Request, res: Response): Promise<{
    readonly accountId: string;
    readonly conversationId: string;
    readonly messageIds: string[];
    readonly extraction: ConversationSignalExtraction;
  } | null> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    const { id } = conversationIdParamsSchema.parse(req.params);
    const { messageIds } = extractConversationSignalsRequestSchema.parse(req.body);
    if (!this.extraction) throw new SignalExtractionUnavailable();

    const abortController = new AbortController();
    const abortOnRequest = () => abortController.abort();
    const abortOnResponseClose = () => { if (!res.writableEnded) abortController.abort(); };
    req.once('aborted', abortOnRequest);
    res.once('close', abortOnResponseClose);
    if (req.aborted || res.destroyed) abortController.abort();
    try {
      const extraction = await this.extraction.execute(accountId, { conversationId: id, messageIds }, abortController.signal);
      if (abortController.signal.aborted || res.destroyed || res.writableEnded) return null;
      return { accountId, conversationId: id.toLowerCase(), messageIds, extraction };
    } catch (error) {
      if (abortController.signal.aborted || req.aborted || res.destroyed) return null;
      throw error;
    } finally {
      req.off('aborted', abortOnRequest);
      res.off('close', abortOnResponseClose);
    }
  }
}
