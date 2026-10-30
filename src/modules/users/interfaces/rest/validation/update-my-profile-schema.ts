import { z } from 'zod';

const optionalName = z.string().trim().min(1).max(100).nullable().optional();
const optionalPhone = z.string().trim().min(7).max(30).regex(/^\+?[0-9().\s-]+$/).nullable().optional();
export const updateMyProfileSchema = z.object({
  firstName: optionalName,
  lastName: optionalName,
  phone: optionalPhone,
}).strict().refine(value => Object.keys(value).length > 0, { message: 'At least one profile field must be provided' });
