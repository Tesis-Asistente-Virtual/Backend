import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RecommendationService } from '../../application/internal/recommendation-service.js';
import { RecommendationsUnavailable } from '../../application/recommendation-errors.js';
import { recommendationSetSchema, unavailableRecommendationsSchema } from '../../domain/model/recommendation-set.js';

export const generateRecommendationsRequestSchema = z.object({ analysisId: z.string().uuid().optional() }).strict();
export const latestRecommendationsResponseSchema = z.union([recommendationSetSchema, unavailableRecommendationsSchema]);

export class RecommendationsController {
  constructor(private readonly service: RecommendationService | null) {}

  async generate(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const request = generateRecommendationsRequestSchema.parse(req.body);
    if (!this.service) throw new RecommendationsUnavailable();
    const abort = new AbortController();
    const onRequestAborted = () => abort.abort();
    const onResponseClosed = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', onRequestAborted);
    res.once('close', onResponseClosed);
    try {
      const generated = await this.service.generate(accountId, request, abort.signal);
      if (!abort.signal.aborted && !res.destroyed && !res.writableEnded) {
        res.status(generated.created ? 201 : 200).json(recommendationSetSchema.parse(generated.recommendations));
      }
    } finally {
      req.off('aborted', onRequestAborted);
      res.off('close', onResponseClosed);
    }
  }

  async latest(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!this.service) throw new RecommendationsUnavailable();
    res.status(200).json(latestRecommendationsResponseSchema.parse(await this.service.latest(accountId)));
  }
}
