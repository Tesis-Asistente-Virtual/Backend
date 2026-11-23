import { z } from 'zod';
import { conversationResultObservationReferenceSchema } from '../../../../shared/domain/conversation-result-observation-reference.js';

export const studentLongitudinalDeclarationContractVersion = '1.1' as const;

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const optionalDescription = z.string().trim().min(1).max(500).optional();

const declarationFields = {
  contractVersion: z.literal(studentLongitudinalDeclarationContractVersion),
  sessionId: uuid,
  conversationId: uuid,
  referencedObservation: conversationResultObservationReferenceSchema,
  source: z.literal('student_self_report'),
  /** The value records an explicit student submission, not clinical validation. */
  confirmationStatus: z.literal('student_confirmed'),
  createdAt: z.string().datetime({ offset: true }),
} as const;

export const studentLongitudinalDeclarationSchema = z.discriminatedUnion('responseType', [
  z.object({
    ...declarationFields,
    responseType: z.literal('continues'),
    optionalDescription,
  }).strict(),
  z.object({
    ...declarationFields,
    responseType: z.literal('changed'),
    optionalDescription,
  }).strict(),
  z.object({
    ...declarationFields,
    responseType: z.literal('unsure'),
  }).strict(),
  z.object({
    ...declarationFields,
    responseType: z.literal('prefer_not_to_answer'),
  }).strict(),
]).superRefine((declaration, context) => {
  if (declaration.conversationId !== declaration.referencedObservation.conversationId) {
    context.addIssue({ code: 'custom', path: ['referencedObservation', 'conversationId'], message: 'Referenced observation must belong to the declaration conversation' });
  }
});

export type StudentLongitudinalDeclaration = z.infer<typeof studentLongitudinalDeclarationSchema>;

/** Pure structural parsing. Identity and authorship must be established by a future application use case. */
export function parseStudentLongitudinalDeclaration(value: unknown): StudentLongitudinalDeclaration {
  return studentLongitudinalDeclarationSchema.parse(value);
}
