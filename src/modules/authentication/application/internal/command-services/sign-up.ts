import { z } from 'zod';
import { hash } from 'argon2';
import { normalizeEmail } from '../../../domain/model/auth-account.js';
import type { SignUpUnitOfWork } from './sign-up-unit-of-work.js';
export const signUpSchema = z.object({ email: z.string().email().max(320), password: z.string().min(12) }).strict();
export class EmailAlreadyRegistered extends Error {}
export class SignUp {
  constructor(private readonly unitOfWork: SignUpUnitOfWork) {}

  async execute(input: unknown) {
    const data = signUpSchema.parse(input);
    const email = normalizeEmail(data.email);
    const passwordHash = await hash(data.password, { type: 2 });

    return this.unitOfWork.execute(async ({ accounts, profiles }) => {
      if (await accounts.findByEmail(email)) throw new EmailAlreadyRegistered();
      const account = await accounts.create(email, passwordHash);
      await profiles.createForAccount(account.id);
      return account;
    });
  }
}
