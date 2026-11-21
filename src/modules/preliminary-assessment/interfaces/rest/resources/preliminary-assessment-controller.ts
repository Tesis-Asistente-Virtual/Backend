import type { Request, Response } from 'express';
import type { GetAssessmentInfo } from '../../../application/internal/query-services/get-assessment-info.js';
import type { ListMyAssessments } from '../../../application/internal/query-services/list-my-assessments.js';
import type { GetMyAssessment } from '../../../application/internal/query-services/get-my-assessment.js';
import type { GetMyAssessmentResult } from '../../../application/internal/query-services/get-my-assessment-result.js';
import type { StartPreliminaryAssessment } from '../../../application/internal/command-services/start-preliminary-assessment.js';
import type { SubmitAssessmentResponse } from '../../../application/internal/command-services/submit-assessment-response.js';
import type { PauseAssessment, ResumeAssessment, WithdrawAssessment } from '../../../application/internal/command-services/change-assessment-state.js';
import type { CompleteAssessment } from '../../../application/internal/command-services/complete-preliminary-assessment.js';
import { assessmentIdParamsSchema, assessmentPaginationSchema, emptyAssessmentBodySchema, startAssessmentBodySchema, submitAssessmentResponseBodySchema } from '../validation/assessment-request-schemas.js';
import { toAssessmentPageResource, toAssessmentResource, toAssessmentResponseResource, toAssessmentResultResource } from '../transformers/assessment-transformer.js';

export class PreliminaryAssessmentController {
  constructor(
    private readonly info: GetAssessmentInfo,
    private readonly start: StartPreliminaryAssessment,
    private readonly list: ListMyAssessments,
    private readonly get: GetMyAssessment,
    private readonly submitResponse: SubmitAssessmentResponse,
    private readonly pauseAssessment: PauseAssessment,
    private readonly resumeAssessment: ResumeAssessment,
    private readonly withdrawAssessment: WithdrawAssessment,
    private readonly completeAssessment: CompleteAssessment,
    private readonly getResult: GetMyAssessmentResult,
  ) {}

  async assessmentInfo(_req: Request, res: Response): Promise<void> {
    const info = await this.info.execute();
    res.status(200).json({ ...info, instruments: info.instruments.map(item => ({
      instrumentId: item.instrumentId, instrumentVersionId: item.instrumentVersionId,
      version: item.version, effectiveAt: item.effectiveAt.toISOString(), questions: item.questions,
    })) });
  }

  async startAssessment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const input = startAssessmentBodySchema.parse(req.body);
    const assessment = await this.start.execute(accountId, input.instrumentVersionId);
    res.status(201).json(toAssessmentResource(assessment));
  }

  async listAssessments(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { limit, offset } = assessmentPaginationSchema.parse(req.query);
    const items = await this.list.execute(accountId, limit + 1, offset);
    res.status(200).json(toAssessmentPageResource(items.slice(0, limit), limit, offset, items.length > limit));
  }

  async getAssessment(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = assessmentIdParamsSchema.parse(req.params);
    res.status(200).json(toAssessmentResource(await this.get.execute(id, accountId)));
  }

  async submit(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = assessmentIdParamsSchema.parse(req.params);
    const input = submitAssessmentResponseBodySchema.parse(req.body);
    res.status(200).json(toAssessmentResponseResource(await this.submitResponse.execute(id, accountId, input.questionId, input.answer)));
  }

  private async changeState(req: Request, res: Response, action: 'pause' | 'resume' | 'withdraw'): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = assessmentIdParamsSchema.parse(req.params);
    emptyAssessmentBodySchema.parse(req.body ?? {});
    const updated = action === 'pause' ? await this.pauseAssessment.execute(id, accountId)
      : action === 'resume' ? await this.resumeAssessment.execute(id, accountId)
        : await this.withdrawAssessment.execute(id, accountId);
    res.status(200).json(toAssessmentResource(updated));
  }

  pause(req: Request, res: Response): Promise<void> { return this.changeState(req, res, 'pause'); }
  resume(req: Request, res: Response): Promise<void> { return this.changeState(req, res, 'resume'); }
  withdraw(req: Request, res: Response): Promise<void> { return this.changeState(req, res, 'withdraw'); }

  async complete(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = assessmentIdParamsSchema.parse(req.params);
    emptyAssessmentBodySchema.parse(req.body ?? {});
    const completed = await this.completeAssessment.execute(id, accountId);
    res.status(200).json({ assessment: toAssessmentResource(completed.assessment), result: toAssessmentResultResource(completed.result) });
  }

  async result(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { id } = assessmentIdParamsSchema.parse(req.params);
    res.status(200).json(toAssessmentResultResource(await this.getResult.execute(id, accountId)));
  }
}
