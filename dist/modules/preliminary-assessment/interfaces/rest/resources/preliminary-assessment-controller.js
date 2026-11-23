import { assessmentIdParamsSchema, assessmentPaginationSchema, emptyAssessmentBodySchema, startAssessmentBodySchema, submitAssessmentResponseBodySchema } from '../validation/assessment-request-schemas.js';
import { toAssessmentPageResource, toAssessmentResource, toAssessmentResponseResource, toAssessmentResultResource } from '../transformers/assessment-transformer.js';
export class PreliminaryAssessmentController {
    info;
    start;
    list;
    get;
    getForm;
    submitResponse;
    pauseAssessment;
    resumeAssessment;
    withdrawAssessment;
    completeAssessment;
    reauthorizeAssessment;
    getResult;
    formMetadata;
    technicalResult;
    constructor(info, start, list, get, getForm, submitResponse, pauseAssessment, resumeAssessment, withdrawAssessment, completeAssessment, reauthorizeAssessment, getResult, formMetadata, technicalResult) {
        this.info = info;
        this.start = start;
        this.list = list;
        this.get = get;
        this.getForm = getForm;
        this.submitResponse = submitResponse;
        this.pauseAssessment = pauseAssessment;
        this.resumeAssessment = resumeAssessment;
        this.withdrawAssessment = withdrawAssessment;
        this.completeAssessment = completeAssessment;
        this.reauthorizeAssessment = reauthorizeAssessment;
        this.getResult = getResult;
        this.formMetadata = formMetadata;
        this.technicalResult = technicalResult;
    }
    async assessmentInfo(_req, res) {
        const info = await this.info.execute();
        res.status(200).json({ ...info, instruments: info.instruments.map(item => ({
                instrumentId: item.instrumentId, instrumentVersionId: item.instrumentVersionId,
                version: item.version, effectiveAt: item.effectiveAt.toISOString(), questions: item.questions,
                ...(this.formMetadata?.(item.instrumentVersionId) ?? {}),
            })) });
    }
    async startAssessment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const input = startAssessmentBodySchema.parse(req.body);
        const assessment = await this.start.execute(accountId, input.instrumentVersionId);
        res.status(201).json(toAssessmentResource(assessment));
    }
    async listAssessments(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { limit, offset } = assessmentPaginationSchema.parse(req.query);
        const items = await this.list.execute(accountId, limit + 1, offset);
        res.status(200).json(toAssessmentPageResource(items.slice(0, limit), limit, offset, items.length > limit));
    }
    async getAssessment(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        res.status(200).json(toAssessmentResource(await this.get.execute(id, accountId)));
    }
    async getAssessmentForm(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        const form = await this.getForm.execute(id, accountId);
        res.status(200).json({
            assessment: toAssessmentResource(form.assessment),
            instrument: {
                ...form.instrument,
                effectiveAt: form.instrument.effectiveAt.toISOString(),
                ...(this.formMetadata?.(form.instrument.instrumentVersionId) ?? {}),
            },
        });
    }
    async submit(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        const input = submitAssessmentResponseBodySchema.parse(req.body);
        res.status(200).json(toAssessmentResponseResource(await this.submitResponse.execute(id, accountId, input.questionId, input.answer)));
    }
    async changeState(req, res, action) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        emptyAssessmentBodySchema.parse(req.body ?? {});
        const updated = action === 'pause' ? await this.pauseAssessment.execute(id, accountId)
            : action === 'resume' ? await this.resumeAssessment.execute(id, accountId)
                : await this.withdrawAssessment.execute(id, accountId);
        res.status(200).json(toAssessmentResource(updated));
    }
    pause(req, res) { return this.changeState(req, res, 'pause'); }
    resume(req, res) { return this.changeState(req, res, 'resume'); }
    withdraw(req, res) { return this.changeState(req, res, 'withdraw'); }
    async reauthorize(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        emptyAssessmentBodySchema.parse(req.body ?? {});
        res.status(200).json(toAssessmentResource(await this.reauthorizeAssessment.execute(id, accountId)));
    }
    async complete(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        emptyAssessmentBodySchema.parse(req.body ?? {});
        const completed = await this.completeAssessment.execute(id, accountId);
        await this.technicalResult?.scoreCompleted(id, accountId);
        res.status(200).json({ assessment: toAssessmentResource(completed.assessment), result: toAssessmentResultResource(completed.result) });
    }
    async result(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = assessmentIdParamsSchema.parse(req.params);
        if (this.technicalResult) {
            res.status(200).json(await this.technicalResult.getResult(id, accountId));
            return;
        }
        res.status(200).json(toAssessmentResultResource(await this.getResult.execute(id, accountId)));
    }
}
