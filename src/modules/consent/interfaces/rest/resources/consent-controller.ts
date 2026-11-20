import type { Request, Response } from 'express';
import type { GetMyConsentStatus } from '../../../application/internal/query-services/get-my-consent-status.js';
import type { ListAvailableConsentNotices } from '../../../application/internal/query-services/list-available-consent-notices.js';
import type { RecordMyConsentDecision } from '../../../application/internal/command-services/record-my-consent-decision.js';
import { consentDecisionSchema } from '../validation/consent-schemas.js';

export class ConsentController {
  constructor(private readonly notices: ListAvailableConsentNotices, private readonly status: GetMyConsentStatus, private readonly decide: RecordMyConsentDecision) {}
  async listNotices(_req: Request, res: Response): Promise<void> {
    const notices = await this.notices.execute();
    res.status(200).json(notices.map(({ id, purpose, version, content, effectiveAt }) => ({ id, purpose, version, content, effectiveAt: effectiveAt.toISOString() })));
  }
  async myStatus(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.status(200).json({ items: await this.status.execute(accountId) });
  }
  async decideForMe(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const input = consentDecisionSchema.parse(req.body);
    const event = await this.decide.execute(accountId, input);
    res.status(201).json({ id: event.id, purpose: event.purpose, noticeVersionId: event.noticeVersionId, action: event.action, createdAt: event.createdAt.toISOString() });
  }
}
