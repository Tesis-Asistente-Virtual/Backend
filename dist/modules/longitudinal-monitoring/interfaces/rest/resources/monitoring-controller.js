import { associateMonitoringConversationBodySchema, emptyMonitoringBodySchema, monitoringEnrollmentIdParamsSchema, monitoringPaginationSchema, monitoringSessionConversationParamsSchema, startMonitoringEnrollmentBodySchema } from '../validation/monitoring-request-schemas.js';
import { toMonitoringConversationAssociationResource, toMonitoringEnrollmentResource, toMonitoringPageResource, toMonitoringSessionResource } from '../transformers/monitoring-transformer.js';
export class MonitoringController {
    info;
    start;
    list;
    get;
    pauseEnrollment;
    resumeEnrollment;
    withdrawEnrollment;
    completeEnrollment;
    createSession;
    listSessions;
    associateConversation;
    constructor(info, start, list, get, pauseEnrollment, resumeEnrollment, withdrawEnrollment, completeEnrollment, createSession, listSessions, associateConversation) {
        this.info = info;
        this.start = start;
        this.list = list;
        this.get = get;
        this.pauseEnrollment = pauseEnrollment;
        this.resumeEnrollment = resumeEnrollment;
        this.withdrawEnrollment = withdrawEnrollment;
        this.completeEnrollment = completeEnrollment;
        this.createSession = createSession;
        this.listSessions = listSessions;
        this.associateConversation = associateConversation;
    }
    async monitoringInfo(_req, res) {
        res.status(200).json(this.info.execute());
    }
    async startEnrollment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const input = startMonitoringEnrollmentBodySchema.parse(req.body);
        res.status(201).json(toMonitoringEnrollmentResource(await this.start.execute(accountId, input.explicitOptIn)));
    }
    async listEnrollments(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { limit, offset } = monitoringPaginationSchema.parse(req.query);
        const items = await this.list.execute(accountId, limit + 1, offset);
        res.status(200).json(toMonitoringPageResource(items, toMonitoringEnrollmentResource, limit, offset));
    }
    async getEnrollment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
        res.status(200).json(toMonitoringEnrollmentResource(await this.get.execute(id, accountId)));
    }
    async transition(req, res, action) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
        emptyMonitoringBodySchema.parse(req.body ?? {});
        const changed = action === 'pause' ? await this.pauseEnrollment.execute(id, accountId)
            : action === 'resume' ? await this.resumeEnrollment.execute(id, accountId)
                : action === 'withdraw' ? await this.withdrawEnrollment.execute(id, accountId)
                    : await this.completeEnrollment.execute(id, accountId);
        res.status(200).json(toMonitoringEnrollmentResource(changed));
    }
    pause(req, res) { return this.transition(req, res, 'pause'); }
    resume(req, res) { return this.transition(req, res, 'resume'); }
    withdraw(req, res) { return this.transition(req, res, 'withdraw'); }
    complete(req, res) { return this.transition(req, res, 'complete'); }
    async createSessionForEnrollment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
        emptyMonitoringBodySchema.parse(req.body ?? {});
        res.status(201).json(toMonitoringSessionResource(await this.createSession.execute(id, accountId)));
    }
    async associateConversationWithSession(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id: enrollmentId, sessionId } = monitoringSessionConversationParamsSchema.parse(req.params);
        const input = associateMonitoringConversationBodySchema.parse(req.body);
        const association = await this.associateConversation.execute(accountId, {
            enrollmentId,
            monitoringSessionId: sessionId,
            ...input,
        });
        res.status(201).json(toMonitoringConversationAssociationResource(association));
    }
    async listSessionsForEnrollment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
        const { limit, offset } = monitoringPaginationSchema.parse(req.query);
        const items = await this.listSessions.execute(id, accountId, limit + 1, offset);
        res.status(200).json(toMonitoringPageResource(items, toMonitoringSessionResource, limit, offset));
    }
}
