import { z } from 'zod';
import { conversationalSignalDimensions } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
const safeText = z.string().trim().min(1).max(500);
export const recommendationEvidenceReferenceSchema = z.object({
    dimension: z.enum(conversationalSignalDimensions),
    evidenceIndex: z.number().int().min(0).max(19),
}).strict();
export const recommendationCardSchema = z.object({
    id: z.string().uuid(),
    kind: z.enum(['evidence_based', 'general']),
    title: safeText,
    description: safeText,
    dimension: z.enum(conversationalSignalDimensions).nullable(),
    justification: safeText,
    sourceAnalysisId: z.string().uuid(),
    evidenceReferences: z.array(recommendationEvidenceReferenceSchema).max(20),
}).strict().superRefine((card, context) => {
    if (card.kind === 'general' && (card.dimension !== null || card.evidenceReferences.length !== 0)) {
        context.addIssue({ code: 'custom', path: ['evidenceReferences'], message: 'General recommendations cannot claim a dimension or evidence' });
    }
    if (card.kind === 'evidence_based' && (card.dimension === null || card.evidenceReferences.length === 0 ||
        card.evidenceReferences.some(reference => reference.dimension !== card.dimension))) {
        context.addIssue({ code: 'custom', path: ['evidenceReferences'], message: 'Evidence-based recommendations require matching source evidence' });
    }
});
export const recommendationSetSchema = z.object({
    contractVersion: z.literal('wellbeing-recommendations-1.0'),
    recommendationSetId: z.string().uuid(),
    status: z.literal('available'),
    sourceAnalysisId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    recommendations: z.array(recommendationCardSchema).min(3).max(5),
    professionalSupportNotice: safeText.nullable(),
    isDiagnostic: z.literal(false),
    isClinicalAdvice: z.literal(false),
    limitations: z.tuple([
        z.literal('exploratory_conversational_evidence_only'),
        z.literal('not_a_diagnosis_or_clinical_assessment'),
        z.literal('not_a_crisis_detector'),
        z.literal('not_a_substitute_for_professional_care'),
        z.literal('generated_from_persisted_analysis_not_messages'),
    ]),
}).strict().superRefine((set, context) => {
    if (set.expiresAt <= set.generatedAt)
        context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Recommendations must expire after generation' });
    set.recommendations.forEach((recommendation, index) => {
        if (recommendation.sourceAnalysisId !== set.sourceAnalysisId) {
            context.addIssue({ code: 'custom', path: ['recommendations', index, 'sourceAnalysisId'], message: 'Recommendation source must match the set source' });
        }
    });
});
export const unavailableRecommendationsSchema = z.object({
    status: z.literal('not_available'),
    reason: z.enum(['no_current_recommendations', 'feature_disabled']),
    isDiagnostic: z.literal(false),
}).strict();
export const buildGeneralRecommendations = (input) => {
    const general = [
        { title: 'Elige un paso pequeño', description: 'Selecciona una tarea cotidiana manejable y decide cuándo dedicarle unos minutos.' },
        { title: 'Haz una pausa breve', description: 'Reserva un momento para descansar de tus actividades y retoma después según te resulte conveniente.' },
        { title: 'Busca una conversación de confianza', description: 'Si te sirve, conversa con alguien de confianza sobre cómo organizar tus próximos días.' },
    ];
    return recommendationSetSchema.parse({
        contractVersion: 'wellbeing-recommendations-1.0', recommendationSetId: input.recommendationSetId,
        status: 'available', sourceAnalysisId: input.sourceAnalysisId, generatedAt: input.generatedAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
        recommendations: general.map(item => ({
            id: input.createId(), kind: 'general', ...item, dimension: null,
            justification: 'Orientación general: esta sugerencia no se personaliza a partir del análisis y no indica presencia ni ausencia de dificultades.',
            sourceAnalysisId: input.sourceAnalysisId, evidenceReferences: [],
        })),
        professionalSupportNotice: input.hasHighEvidence
            ? 'Si lo deseas, puedes conversar con un profesional de salud mental. Este análisis describe evidencia textual exploratoria; no evalúa riesgo ni reemplaza atención profesional.'
            : null,
        isDiagnostic: false, isClinicalAdvice: false,
        limitations: [
            'exploratory_conversational_evidence_only', 'not_a_diagnosis_or_clinical_assessment',
            'not_a_crisis_detector', 'not_a_substitute_for_professional_care', 'generated_from_persisted_analysis_not_messages',
        ],
    });
};
export function getEligibleSignalDimensions(analysis) {
    const eligible = [];
    for (const dimension of ['depression', 'anxiety', 'stress']) {
        const signal = analysis.signals[dimension];
        if (signal.level === 'low' || signal.level === 'moderate') {
            eligible.push({ dimension, signal: signal });
        }
    }
    return eligible;
}
