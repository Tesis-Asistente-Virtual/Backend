import { z } from 'zod';
import type { ConversationalSignalAnalysisRepository } from '../../../domain/repositories/conversational-signal-analysis-repository.js';

const purgeRequestSchema = z.object({
  asOf: z.date(),
  limit: z.number().int().min(1).max(500),
  ownerAccountId: z.string().uuid().optional(),
}).strict();

/** Internal maintenance use case. A deployment runner must independently enforce database targeting and scheduling. */
export class PurgeExpiredConversationalSignalAnalyses {
  constructor(private readonly analyses: Pick<ConversationalSignalAnalysisRepository, 'purgeExpiredBatch'>) {}

  execute(input: { asOf: Date; limit: number; ownerAccountId?: string }): Promise<number> {
    const request = purgeRequestSchema.parse(input);
    return this.analyses.purgeExpiredBatch(request.asOf, request.limit, request.ownerAccountId);
  }
}
