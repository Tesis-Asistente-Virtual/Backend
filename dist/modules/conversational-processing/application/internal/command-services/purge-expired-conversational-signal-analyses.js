import { z } from 'zod';
const purgeRequestSchema = z.object({
    asOf: z.date(),
    limit: z.number().int().min(1).max(500),
    ownerAccountId: z.string().uuid().optional(),
}).strict();
/** Internal maintenance use case. A deployment runner must independently enforce database targeting and scheduling. */
export class PurgeExpiredConversationalSignalAnalyses {
    analyses;
    constructor(analyses) {
        this.analyses = analyses;
    }
    execute(input) {
        const request = purgeRequestSchema.parse(input);
        return this.analyses.purgeExpiredBatch(request.asOf, request.limit, request.ownerAccountId);
    }
}
