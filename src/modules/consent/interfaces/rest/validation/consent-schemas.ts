import { z } from 'zod';
import { consentActions, consentPurposes } from '../../../domain/model/consent.js';
export const consentDecisionSchema = z.object({
  purpose: z.enum(consentPurposes),
  noticeVersionId: z.string().uuid(),
  action: z.enum(consentActions),
  idempotencyKey: z.string().uuid(),
}).strict();
