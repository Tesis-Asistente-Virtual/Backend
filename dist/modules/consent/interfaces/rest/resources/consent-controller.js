import { consentDecisionSchema } from '../validation/consent-schemas.js';
export class ConsentController {
    notices;
    status;
    decide;
    constructor(notices, status, decide) {
        this.notices = notices;
        this.status = status;
        this.decide = decide;
    }
    async listNotices(_req, res) {
        const notices = await this.notices.execute();
        res.status(200).json(notices.map(({ id, purpose, version, content, effectiveAt }) => ({ id, purpose, version, content, effectiveAt: effectiveAt.toISOString() })));
    }
    async myStatus(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        res.status(200).json({ items: await this.status.execute(accountId) });
    }
    async decideForMe(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const input = consentDecisionSchema.parse(req.body);
        const event = await this.decide.execute(accountId, input);
        res.status(201).json({ id: event.id, purpose: event.purpose, noticeVersionId: event.noticeVersionId, action: event.action, createdAt: event.createdAt.toISOString() });
    }
}
