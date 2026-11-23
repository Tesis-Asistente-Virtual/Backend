import { z } from 'zod';
import { DASS21_ITEMS_BY_DIMENSION } from './dass21-scoring.js';
/** This version is a source-transcribed candidate, never an approved instrument version. */
export const DASS21_SPANISH_CANDIDATE_VERSION = 'dass21-spanish-candidate-1.1';
const itemNumbersByDimension = new Map(Object.entries(DASS21_ITEMS_BY_DIMENSION).flatMap(([dimension, numbers]) => numbers.map(number => [number, dimension])));
const responseOptionSchema = z.discriminatedUnion('scoringValue', [
    z.object({ scoringValue: z.literal(0), label: z.string().min(1) }).strict(),
    z.object({ scoringValue: z.literal(1), label: z.string().min(1) }).strict(),
    z.object({ scoringValue: z.literal(2), label: z.string().min(1) }).strict(),
    z.object({ scoringValue: z.literal(3), label: z.string().min(1) }).strict(),
]);
const itemSlotSchema = z.object({
    itemNumber: z.number().int().min(1).max(21),
    displayOrder: z.number().int().min(1).max(21),
    promptOriginal: z.string().min(1),
    dimension: z.enum(['depression', 'anxiety', 'stress']),
    responseOptions: z.tuple([
        responseOptionSchema,
        responseOptionSchema,
        responseOptionSchema,
        responseOptionSchema,
    ]),
}).strict().superRefine((item, context) => {
    if (item.responseOptions.some((option, index) => option.scoringValue !== index)) {
        context.addIssue({ code: 'custom', path: ['responseOptions'], message: 'Candidate response options must retain the source order and server scoring values 0 through 3' });
    }
});
export const dass21SpanishCandidateSchema = z.object({
    schemaVersion: z.literal('1.1'),
    candidateVersion: z.literal(DASS21_SPANISH_CANDIDATE_VERSION),
    instrumentCode: z.literal('DASS-21'),
    language: z.literal('es'),
    candidateId: z.literal('daza-et-al-2002-spanish-candidate'),
    translation: z.object({
        citation: z.literal('Daza, Novy, Stanley & Averill (2002), The Depression Anxiety Stress Scale-21: Spanish translation and validation with a Hispanic sample, Journal of Psychopathology and Behavioral Assessment, 24(3), 195–205.'),
        sourceUrl: z.literal('https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm'),
        publicationUrl: z.literal('https://doi.org/10.1023/A:1016014818163'),
        sourceFileName: z.literal('DASS21_Spanish_Daza.doc'),
        sourceSha256: z.literal('b673e8b99bd521b856555e528daf8d4b1320a9928fe07114f26be6ac17ba021a'),
        hashVerification: z.literal('matched_user_expected_hash_not_origin_proof'),
        verifiedOn: z.literal('2026-11-23'),
    }).strict(),
    instructionsOriginal: z.literal('Por favor lea las siguientes afirmaciones y coloque un círculo alrededor de un número (0, 1, 2, 3) que indica cuánto esta afirmación le aplicó a usted durante la semana pasada. No hay respuestas correctas o incorrectas. No tome demasiado tiempo para contestar.'),
    responseScaleHeadingOriginal: z.literal('La escala de calificación es la siguiente:'),
    referencePeriod: z.literal('durante la semana pasada'),
    populationEvidence: z.literal('A 2025 psychometric study in students at one public university in Lima cites the Daza Spanish adaptation; exact deployed text/version still requires professional review and does not establish approval for this thesis.'),
    sourceCotejoStatus: z.literal('source_hash_matched_content_read_scoring_key_verified'),
    professionalReviewStatus: z.literal('pending'),
    approvalStatus: z.literal('not_approved'),
    availability: z.literal('not_available'),
    items: z.array(itemSlotSchema).length(21),
}).strict().superRefine((candidate, context) => {
    const itemNumbers = candidate.items.map(item => item.itemNumber);
    const positions = candidate.items.map(item => item.displayOrder);
    if (new Set(itemNumbers).size !== 21 || new Set(positions).size !== 21 ||
        itemNumbers.some((number, index) => number !== index + 1) ||
        positions.some((position, index) => position !== index + 1)) {
        context.addIssue({ code: 'custom', path: ['items'], message: 'Candidate slots must cover item numbers and display order 1 through 21 exactly once and in order' });
    }
    candidate.items.forEach((item, index) => {
        if (item.dimension !== itemNumbersByDimension.get(index + 1)) {
            context.addIssue({ code: 'custom', path: ['items', index, 'dimension'], message: 'Item dimension must match the independently verified DASS-21 scoring template' });
        }
    });
});
const responseOptions = Object.freeze([
    Object.freeze({ scoringValue: 0, label: 'No me aplicó' }),
    Object.freeze({ scoringValue: 1, label: 'Me aplicó un poco, o durante parte del tiempo' }),
    Object.freeze({ scoringValue: 2, label: 'Me aplicó bastante, o durante una buena parte del tiempo' }),
    Object.freeze({ scoringValue: 3, label: 'Me aplicó mucho, o la mayor parte del tiempo' }),
]);
const promptTexts = Object.freeze([
    'Me costó mucho relajarme',
    'Me di cuenta que tenia la boca seca',
    'No podía sentir ningún sentimiento positivo',
    'Se me hizo difícil respirar',
    'Se me hizo difícil tomar la iniciativa para hacer cosas',
    'Reaccioné exageradamente en ciertas situaciones',
    'Sentí que mis manos temblaban',
    'Sentí que tenia muchos nervios',
    'Estaba preocupado por situaciones en las cuales podía tener pánico o en las que podría hacer el ridículo',
    'Sentí que no tenia nada por que vivir',
    'Noté que me agitaba',
    'Se me hizo difícil relajarme',
    'Me sentí triste y deprimido',
    'No toleré nada que no me permitiera continuar con lo que estaba haciendo',
    'Sentí que estaba al punto de pánico',
    'No me pude entusiasmar por nada',
    'Sentí que valía muy poco como persona',
    'Sentí que estaba muy irritable',
    'Sentí los latidos de mi corazón a pesar de no haber hecho ningún esfuerzo físico',
    'Tuve miedo sin razón',
    'Sentí que la vida no tenia ningún sentido',
]);
const slots = Object.freeze(promptTexts.map((promptOriginal, index) => Object.freeze({
    itemNumber: index + 1,
    displayOrder: index + 1,
    promptOriginal,
    dimension: itemNumbersByDimension.get(index + 1),
    responseOptions,
})));
/**
 * Source-transcribed, structurally verified preparation metadata. It is not
 * connected to the instrument catalog, form endpoint, scoring use case, or API.
 * Source wording (including spelling) is intentionally left unchanged.
 */
const parsedCandidate = dass21SpanishCandidateSchema.parse(Object.freeze({
    schemaVersion: '1.1',
    candidateVersion: DASS21_SPANISH_CANDIDATE_VERSION,
    instrumentCode: 'DASS-21',
    language: 'es',
    candidateId: 'daza-et-al-2002-spanish-candidate',
    translation: Object.freeze({
        citation: 'Daza, Novy, Stanley & Averill (2002), The Depression Anxiety Stress Scale-21: Spanish translation and validation with a Hispanic sample, Journal of Psychopathology and Behavioral Assessment, 24(3), 195–205.',
        sourceUrl: 'https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm',
        publicationUrl: 'https://doi.org/10.1023/A:1016014818163',
        sourceFileName: 'DASS21_Spanish_Daza.doc',
        sourceSha256: 'b673e8b99bd521b856555e528daf8d4b1320a9928fe07114f26be6ac17ba021a',
        hashVerification: 'matched_user_expected_hash_not_origin_proof',
        verifiedOn: '2026-11-23',
    }),
    instructionsOriginal: 'Por favor lea las siguientes afirmaciones y coloque un círculo alrededor de un número (0, 1, 2, 3) que indica cuánto esta afirmación le aplicó a usted durante la semana pasada. No hay respuestas correctas o incorrectas. No tome demasiado tiempo para contestar.',
    responseScaleHeadingOriginal: 'La escala de calificación es la siguiente:',
    referencePeriod: 'durante la semana pasada',
    populationEvidence: 'A 2025 psychometric study in students at one public university in Lima cites the Daza Spanish adaptation; exact deployed text/version still requires professional review and does not establish approval for this thesis.',
    sourceCotejoStatus: 'source_hash_matched_content_read_scoring_key_verified',
    professionalReviewStatus: 'pending',
    approvalStatus: 'not_approved',
    availability: 'not_available',
    items: slots,
}));
export const DASS21_SPANISH_CANDIDATE = Object.freeze({
    ...parsedCandidate,
    translation: Object.freeze({ ...parsedCandidate.translation }),
    items: Object.freeze(parsedCandidate.items.map(item => Object.freeze({
        ...item,
        responseOptions: Object.freeze(item.responseOptions.map(option => Object.freeze({ ...option }))),
    }))),
});
