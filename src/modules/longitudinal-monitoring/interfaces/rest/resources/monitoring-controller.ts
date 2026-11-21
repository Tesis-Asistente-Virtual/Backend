import type { Request, Response } from 'express';
import type { GetMonitoringInfo } from '../../../application/internal/query-services/get-monitoring-info.js';
import type { ListMyMonitoringEnrollments } from '../../../application/internal/query-services/list-my-monitoring-enrollments.js';
import type { GetMyMonitoringEnrollment } from '../../../application/internal/query-services/get-my-monitoring-enrollment.js';
import type { ListMyMonitoringSessions } from '../../../application/internal/query-services/list-my-monitoring-sessions.js';
import type { StartMonitoringEnrollment } from '../../../application/internal/command-services/start-monitoring-enrollment.js';
import type { PauseMonitoringEnrollment, ResumeMonitoringEnrollment, WithdrawMonitoringEnrollment, CompleteMonitoringEnrollment } from '../../../application/internal/command-services/change-monitoring-enrollment-state.js';
import type { CreateMonitoringSession } from '../../../application/internal/command-services/create-monitoring-session.js';
import { emptyMonitoringBodySchema, monitoringEnrollmentIdParamsSchema, monitoringPaginationSchema, startMonitoringEnrollmentBodySchema } from '../validation/monitoring-request-schemas.js';
import { toMonitoringEnrollmentResource, toMonitoringPageResource, toMonitoringSessionResource } from '../transformers/monitoring-transformer.js';

export class MonitoringController {
  constructor(
    private readonly info: GetMonitoringInfo,
    private readonly start: StartMonitoringEnrollment,
    private readonly list: ListMyMonitoringEnrollments,
    private readonly get: GetMyMonitoringEnrollment,
    private readonly pauseEnrollment: PauseMonitoringEnrollment,
    private readonly resumeEnrollment: ResumeMonitoringEnrollment,
    private readonly withdrawEnrollment: WithdrawMonitoringEnrollment,
    private readonly completeEnrollment: CompleteMonitoringEnrollment,
    private readonly createSession: CreateMonitoringSession,
    private readonly listSessions: ListMyMonitoringSessions,
  ) {}

  async monitoringInfo(_req: Request, res: Response): Promise<void> {
    res.status(200).json(this.info.execute());
  }

  async startEnrollment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const input = startMonitoringEnrollmentBodySchema.parse(req.body);
    res.status(201).json(toMonitoringEnrollmentResource(await this.start.execute(accountId, input.explicitOptIn)));
  }

  async listEnrollments(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { limit, offset } = monitoringPaginationSchema.parse(req.query);
    const items = await this.list.execute(accountId, limit + 1, offset);
    res.status(200).json(toMonitoringPageResource(items, toMonitoringEnrollmentResource, limit, offset));
  }

  async getEnrollment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
    res.status(200).json(toMonitoringEnrollmentResource(await this.get.execute(id, accountId)));
  }

  private async transition(req: Request, res: Response, action: 'pause' | 'resume' | 'withdraw' | 'complete'): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
    emptyMonitoringBodySchema.parse(req.body ?? {});
    const changed = action === 'pause' ? await this.pauseEnrollment.execute(id, accountId)
      : action === 'resume' ? await this.resumeEnrollment.execute(id, accountId)
        : action === 'withdraw' ? await this.withdrawEnrollment.execute(id, accountId)
          : await this.completeEnrollment.execute(id, accountId);
    res.status(200).json(toMonitoringEnrollmentResource(changed));
  }

  pause(req: Request, res: Response) { return this.transition(req, res, 'pause'); }
  resume(req: Request, res: Response) { return this.transition(req, res, 'resume'); }
  withdraw(req: Request, res: Response) { return this.transition(req, res, 'withdraw'); }
  complete(req: Request, res: Response) { return this.transition(req, res, 'complete'); }

  async createSessionForEnrollment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
    emptyMonitoringBodySchema.parse(req.body ?? {});
    res.status(201).json(toMonitoringSessionResource(await this.createSession.execute(id, accountId)));
  }

  async listSessionsForEnrollment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = monitoringEnrollmentIdParamsSchema.parse(req.params);
    const { limit, offset } = monitoringPaginationSchema.parse(req.query);
    const items = await this.listSessions.execute(id, accountId, limit + 1, offset);
    res.status(200).json(toMonitoringPageResource(items, toMonitoringSessionResource, limit, offset));
  }
}
