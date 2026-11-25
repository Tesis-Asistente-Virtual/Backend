import { z } from 'zod';
import { conversationalSignalDimensions, exploratoryEvidenceLevels } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';

const userReason = z.string().trim().min(1).max(1200).refine(
  value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) &&
    !/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u.test(value) &&
    !/\b(?:\+?51\s*)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/u.test(value),
  'Reason must not include contact details or control characters',
);

export const createPsychologicalReferralRequestSchema = z.object({
  reason: userReason.optional(),
  sourceAnalysisId: z.string().uuid().optional(),
}).strict();

const reportSignalSchema = z.object({
  level: z.enum(exploratoryEvidenceLevels),
  summary: z.string().trim().min(1).max(500),
  evidence: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

export const psychologicalReferralReportSchema = z.object({
  contractVersion: z.literal('psychological-referral-report-1.0'),
  referralId: z.string().uuid(),
  createdAt: z.string().datetime(),
  reason: z.string().max(1200).nullable(),
  sourceAnalysisId: z.string().uuid().nullable(),
  analysisVersion: z.string().max(40).nullable(),
  analysisAnalyzedAt: z.string().datetime().nullable(),
  overallSummary: z.string().max(500).nullable(),
  findingsAvailability: z.enum(['included', 'no_analysis_attached']),
  signals: z.object({
    depression: reportSignalSchema,
    anxiety: reportSignalSchema,
    stress: reportSignalSchema,
  }).strict().nullable(),
  absenceOfFindings: z.boolean(),
  isDiagnostic: z.literal(false),
  limitations: z.tuple([
    z.literal('exploratory_textual_evidence_only'),
    z.literal('levels_are_not_clinical_severity_or_risk'),
    z.literal('not_a_diagnosis_or_clinical_assessment'),
    z.literal('not_a_crisis_detector_or_safety_assessment'),
    z.literal('no_full_messages_or_dass21_data_included'),
  ]),
}).strict().superRefine((report, context) => {
  if (report.findingsAvailability === 'no_analysis_attached' &&
    (report.sourceAnalysisId !== null || report.analysisVersion !== null || report.analysisAnalyzedAt !== null ||
      report.overallSummary !== null || report.signals !== null || !report.absenceOfFindings)) {
    context.addIssue({ code: 'custom', path: ['findingsAvailability'], message: 'No-analysis reports cannot claim findings' });
  }
  if (report.findingsAvailability === 'included' &&
    (report.sourceAnalysisId === null || report.analysisVersion === null || report.analysisAnalyzedAt === null ||
      report.overallSummary === null || report.signals === null)) {
    context.addIssue({ code: 'custom', path: ['sourceAnalysisId'], message: 'Included analysis report requires its source metadata' });
  }
  if (report.signals && report.absenceOfFindings !== conversationalSignalDimensions.every(dimension =>
    report.signals?.[dimension].evidence.length === 0)) {
    context.addIssue({ code: 'custom', path: ['absenceOfFindings'], message: 'Absence flag must reflect whether source evidence is empty' });
  }
});

export const psychologicalReferralStateSchema = z.enum(['draft', 'sending', 'sent', 'failed', 'delivery_unknown', 'cancelled']);
export type PsychologicalReferralReport = z.infer<typeof psychologicalReferralReportSchema>;
export type PsychologicalReferralState = z.infer<typeof psychologicalReferralStateSchema>;

export const createReferralReport = (input: {
  referralId: string;
  createdAt: Date;
  reason: string | null;
  source: {
    analysisId: string;
    analysisVersion: string;
    analyzedAt: string;
    overallSummary: string;
    signals: PsychologicalReferralReport['signals'] & {};
  } | null;
}): PsychologicalReferralReport => psychologicalReferralReportSchema.parse({
  contractVersion: 'psychological-referral-report-1.0',
  referralId: input.referralId,
  createdAt: input.createdAt.toISOString(),
  reason: input.reason,
  sourceAnalysisId: input.source?.analysisId ?? null,
  analysisVersion: input.source?.analysisVersion ?? null,
  analysisAnalyzedAt: input.source?.analyzedAt ?? null,
  overallSummary: input.source?.overallSummary ?? null,
  findingsAvailability: input.source ? 'included' : 'no_analysis_attached',
  signals: input.source?.signals ?? null,
  absenceOfFindings: input.source
    ? conversationalSignalDimensions.every(dimension => input.source?.signals[dimension].evidence.length === 0)
    : true,
  isDiagnostic: false,
  limitations: [
    'exploratory_textual_evidence_only', 'levels_are_not_clinical_severity_or_risk',
    'not_a_diagnosis_or_clinical_assessment', 'not_a_crisis_detector_or_safety_assessment',
    'no_full_messages_or_dass21_data_included',
  ],
});

export const psychologicalReferralPreviewSchema = z.object({
  referralId: z.string().uuid(),
  status: psychologicalReferralStateSchema,
  recipient: z.string().email().nullable(),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  report: psychologicalReferralReportSchema.nullable(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  deliveryReference: z.string().max(200).nullable(),
  isDiagnostic: z.literal(false),
}).strict();
