import { createHash, randomUUID } from 'node:crypto';
import type { ConversationalSignalAnalysis } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
import { conversationalSignalDimensions } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
import type { ReferralMailer } from '../ports/referral-mailer.js';
import { ReferralMailerError } from '../ports/referral-mailer.js';
import type { PsychologicalReferralRepository, ReferralRecord } from '../ports/referral-repository.js';
import { ReferralConfirmationInvalid, ReferralDeliveryUnavailable, ReferralFeatureUnavailable, ReferralNotFound, ReferralStateConflict } from '../referral-errors.js';
import type { PsychologicalReferralPolicy } from '../referral-policy.js';
import { createReferralReport, psychologicalReferralPreviewSchema, type PsychologicalReferralReport } from '../../domain/model/psychological-referral.js';

export interface ReferralClock { (): Date }

export function hashReferralPreview(recipient: string, report: PsychologicalReferralReport): string {
  return createHash('sha256').update(JSON.stringify({ recipient, report }), 'utf8').digest('hex');
}

export function buildReferralEmailBody(report: PsychologicalReferralReport): string {
  const lines = [
    'Solicitud voluntaria de orientación psicológica.',
    `Referencia: ${report.referralId}`,
    `Fecha: ${report.createdAt}`,
    `Motivo proporcionado: ${report.reason ?? 'No se proporcionó un motivo.'}`,
    '',
    report.sourceAnalysisId ? `Análisis conversacional de origen: ${report.sourceAnalysisId} (${report.analysisVersion}; ${report.analysisAnalyzedAt}).` : 'No se adjuntó análisis conversacional.',
    report.overallSummary ?? 'No hay hallazgos conversacionales adjuntos.',
  ];
  if (report.signals) {
    for (const dimension of conversationalSignalDimensions) {
      const signal = report.signals[dimension];
      lines.push('', `${dimension}: nivel textual exploratorio ${signal.level}.`, signal.summary);
      for (const paraphrase of signal.evidence) lines.push(`- Evidencia parafraseada: ${paraphrase}`);
    }
  }
  lines.push('', 'Limitaciones: la información es exploratoria y no diagnóstica; los niveles no expresan gravedad clínica ni riesgo y no constituyen evaluación de seguridad o crisis.', 'No incluye mensajes completos ni datos DASS-21.');
  return lines.join('\n');
}

export class PsychologicalReferralService {
  constructor(
    private readonly repository: PsychologicalReferralRepository,
    private readonly mailer: ReferralMailer | null,
    private readonly policy: PsychologicalReferralPolicy,
    private readonly clock: ReferralClock = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async create(accountId: string, request: { reason?: string; sourceAnalysisId?: string }, idempotencyKey: string) {
    const now = this.clock();
    const referralId = this.createId();
    const recipient = this.policy.selectedTestRecipient;
    if (!recipient) throw new ReferralFeatureUnavailable();
    const result = await this.repository.createDraft({
      accountId: accountId.toLowerCase(), idempotencyKey, recipient,
      reason: request.reason?.trim() ?? null, sourceAnalysisId: request.sourceAnalysisId,
      referralId, now,
      report: source => createReferralReport({
        referralId, createdAt: now, reason: request.reason?.trim() ?? null,
        source: source ? this.toReportSource(source) : null,
      }),
      previewHash: source => hashReferralPreview(recipient, createReferralReport({
        referralId, createdAt: now, reason: request.reason?.trim() ?? null,
        source: source ? this.toReportSource(source) : null,
      })),
    });
    return { created: result.created, preview: this.toPreview(result.record) };
  }

  async get(accountId: string, referralId: string) {
    const record = await this.repository.getForOwner({ accountId: accountId.toLowerCase(), referralId, now: this.clock() });
    if (!record) throw new ReferralNotFound();
    return this.toPreview(record);
  }

  async send(accountId: string, input: { referralId: string; previewHash: string; idempotencyKey: string; confirmed: true }) {
    if (!this.mailer) {
      console.error('[psychological-referrals] send blocked: SMTP mailer is not configured');
      throw new ReferralFeatureUnavailable();
    }
    const recipient = this.policy.selectedTestRecipient;
    if (!recipient) {
      console.error('[psychological-referrals] send blocked: test recipient is not configured');
      throw new ReferralFeatureUnavailable();
    }
    const reserved = await this.repository.reserveSend({
      accountId: accountId.toLowerCase(), referralId: input.referralId, idempotencyKey: input.idempotencyKey,
      previewHash: input.previewHash, recipient, attemptId: this.createId(), now: this.clock(),
    });
    if (!reserved) throw new ReferralNotFound();
    if (reserved.kind === 'already_sent') return { preview: this.toPreview(reserved.record), duplicate: true };
    const report = reserved.record.report;
    if (!report || reserved.record.previewHash !== input.previewHash || !input.confirmed) throw new ReferralConfirmationInvalid();
    try {
      const sent = await this.mailer.send({ recipient, bodyText: buildReferralEmailBody(report) });
      await this.repository.markSent({
        accountId: accountId.toLowerCase(), referralId: input.referralId,
        attemptId: reserved.attemptId, messageId: sent.messageId, now: this.clock(),
      });
      const refreshed = await this.repository.getForOwner({ accountId: accountId.toLowerCase(), referralId: input.referralId, now: this.clock() });
      if (!refreshed) throw new ReferralNotFound();
      return { preview: this.toPreview(refreshed), duplicate: false };
    } catch (error) {
      const outcome = error instanceof ReferralMailerError && error.kind === 'unavailable' ? 'failed' : 'delivery_unknown';
      console.error('[psychological-referrals] delivery failed', {
        outcome, errorName: error instanceof Error ? error.name : 'unknown',
        ...(error instanceof ReferralMailerError ? error.diagnostics : {}),
      });
      await this.repository.markDeliveryFailed({ accountId: accountId.toLowerCase(), referralId: input.referralId, attemptId: reserved.attemptId, outcome });
      throw new ReferralDeliveryUnavailable(outcome === 'failed' ? 'unavailable' : 'delivery_unknown');
    }
  }

  async cancel(accountId: string, referralId: string) {
    const cancelled = await this.repository.cancelDraft({ accountId: accountId.toLowerCase(), referralId, now: this.clock() });
    if (!cancelled) throw new ReferralNotFound();
    return { referralId, status: 'cancelled' as const };
  }

  private toReportSource(source: ConversationalSignalAnalysis) {
    return {
      analysisId: source.analysisId,
      analysisVersion: source.analysisVersion,
      analyzedAt: source.analyzedAt,
      overallSummary: source.overallSummary,
      signals: Object.fromEntries(conversationalSignalDimensions.map(dimension => [dimension, {
        level: source.signals[dimension].level,
        summary: source.signals[dimension].summary,
        evidence: source.signals[dimension].evidence.map(item => item.paraphrase),
      }])) as NonNullable<PsychologicalReferralReport['signals']>,
    };
  }

  private toPreview(record: ReferralRecord) {
    return psychologicalReferralPreviewSchema.parse({
      referralId: record.referralId, status: record.status,
      recipient: record.status === 'cancelled' ? null : record.recipient,
      previewHash: record.status === 'draft' ? record.previewHash : null,
      report: record.status === 'cancelled' ? null : record.report,
      createdAt: record.createdAt.toISOString(),
      sentAt: record.sentAt?.toISOString() ?? null,
      deliveryReference: record.deliveryReference,
      isDiagnostic: false,
    });
  }
}
