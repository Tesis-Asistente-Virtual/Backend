import type { Request, Response } from 'express';
import { z } from 'zod';
import { conversationalSignalAnalysisSchema } from '../../domain/model/conversational-signal-analysis.js';
import { ConversationalSignalAnalysisMessagesInvalid, ConversationalSignalAnalysisUnavailable } from '../../application/internal/command-services/analyze-authorized-conversation-signals.js';

const uuid = z.string().uuid();
export const analyzeConversationSignalsRequestSchema = z.object({
  messageIds: z.array(uuid).min(1).max(20).refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length),
}).strict();
export const latestConversationalSignalsResponseSchema = z.union([
  conversationalSignalAnalysisSchema.omit({ accountId: true }),
  z.object({ status: z.literal('not_available'), reason: z.literal('no_analysis'), isDiagnostic: z.literal(false), isValidatedClinicalScale: z.literal(false) }).strict(),
]);
export const conversationalSignalsHistoryResponseSchema = z.object({
  status: z.literal('available'),
  items: z.array(conversationalSignalAnalysisSchema.omit({ accountId: true })).max(20),
}).strict();

export interface ConversationalSignalAnalysisCommand {
  execute(accountId: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}
export interface ConversationalSignalAnalysisQuery {
  latest(accountId: string): Promise<unknown | null>;
  history(accountId: string, limit: number): Promise<unknown[]>;
}

export class ConversationSignalAnalysisController {
  constructor(private readonly command: ConversationalSignalAnalysisCommand | null, private readonly query: ConversationalSignalAnalysisQuery | null) {}

  async analyze(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const conversationId = uuid.safeParse(req.params.id);
    const body = analyzeConversationSignalsRequestSchema.safeParse(req.body);
    if (!conversationId.success || !body.success) throw new ConversationalSignalAnalysisMessagesInvalid();
    if (!this.command) throw new ConversationalSignalAnalysisUnavailable();
    const abort = new AbortController();
    const abortOnRequest = () => abort.abort();
    const abortOnClose = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', abortOnRequest);
    res.once('close', abortOnClose);
    try {
      const analysis = await this.command.execute(accountId, { conversationId: conversationId.data, messageIds: body.data.messageIds }, abort.signal);
      if (!abort.signal.aborted && !res.destroyed && !res.writableEnded) {
        const { accountId: _owner, ...publicAnalysis } = conversationalSignalAnalysisSchema.parse(analysis);
        res.status(200).json(latestConversationalSignalsResponseSchema.parse(publicAnalysis));
      }
    } finally {
      req.off('aborted', abortOnRequest);
      res.off('close', abortOnClose);
    }
  }

  async latest(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!this.query) throw new ConversationalSignalAnalysisUnavailable();
    const analysis = await this.query.latest(accountId);
    if (!analysis) {
      res.status(200).json({ status: 'not_available', reason: 'no_analysis', isDiagnostic: false, isValidatedClinicalScale: false });
      return;
    }
    const { accountId: _owner, ...publicAnalysis } = conversationalSignalAnalysisSchema.parse(analysis);
    res.status(200).json(latestConversationalSignalsResponseSchema.parse(publicAnalysis));
  }

  async history(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!this.query) throw new ConversationalSignalAnalysisUnavailable();
    const limit = req.query.limit === undefined ? 20 : z.coerce.number().int().min(1).max(20).parse(req.query.limit);
    const items = (await this.query.history(accountId, limit)).map(item => {
      const { accountId: _owner, ...publicAnalysis } = conversationalSignalAnalysisSchema.parse(item);
      return publicAnalysis;
    });
    res.status(200).json(conversationalSignalsHistoryResponseSchema.parse({ status: 'available', items }));
  }
}
