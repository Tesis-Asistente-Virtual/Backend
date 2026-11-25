import type { Request, Response } from 'express';
import { z } from 'zod';
import { createPsychologicalReferralRequestSchema, psychologicalReferralPreviewSchema } from '../../domain/model/psychological-referral.js';
import type { PsychologicalReferralService } from '../../application/internal/psychological-referral-service.js';

const uuid = z.string().uuid();
const idempotencyHeaderSchema = z.string().uuid();
export const sendPsychologicalReferralRequestSchema = z.object({
  confirmed: z.literal(true),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export class PsychologicalReferralController {
  constructor(private readonly service: PsychologicalReferralService | null) {}

  async create(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const body = createPsychologicalReferralRequestSchema.parse(req.body ?? {});
    const idempotencyKey = idempotencyHeaderSchema.parse(req.get('Idempotency-Key'));
    if (!this.service) { res.status(503).json({ error: 'Psychological referral is unavailable' }); return; }
    const result = await this.service.create(accountId, body, idempotencyKey);
    res.status(result.created ? 201 : 200).json(psychologicalReferralPreviewSchema.parse(result.preview));
  }

  async get(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const referralId = uuid.parse(req.params.id);
    if (!this.service) { res.status(503).json({ error: 'Psychological referral is unavailable' }); return; }
    res.status(200).json(psychologicalReferralPreviewSchema.parse(await this.service.get(accountId, referralId)));
  }

  async send(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const referralId = uuid.parse(req.params.id);
    const body = sendPsychologicalReferralRequestSchema.parse(req.body);
    const idempotencyKey = idempotencyHeaderSchema.parse(req.get('Idempotency-Key'));
    if (!this.service) { res.status(503).json({ error: 'Psychological referral is unavailable' }); return; }
    const result = await this.service.send(accountId, { referralId, ...body, idempotencyKey });
    res.status(200).json({ ...psychologicalReferralPreviewSchema.parse(result.preview), duplicate: result.duplicate });
  }

  async cancel(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const referralId = uuid.parse(req.params.id);
    if (!this.service) { res.status(503).json({ error: 'Psychological referral is unavailable' }); return; }
    res.status(200).json(await this.service.cancel(accountId, referralId));
  }
}
