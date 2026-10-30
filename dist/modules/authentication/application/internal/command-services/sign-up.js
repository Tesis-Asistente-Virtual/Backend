import { z } from 'zod';
import { hash } from 'argon2';
import { normalizeEmail } from '../../../domain/model/auth-account.js';
export const signUpSchema = z.object({ email: z.string().email().max(320), password: z.string().min(12) }).strict();
export class EmailAlreadyRegistered extends Error {
}
export class SignUp {
    unitOfWork;
    constructor(unitOfWork) {
        this.unitOfWork = unitOfWork;
    }
    async execute(input) {
        const data = signUpSchema.parse(input);
        const email = normalizeEmail(data.email);
        const passwordHash = await hash(data.password, { type: 2 });
        return this.unitOfWork.execute(async ({ accounts, profiles }) => {
            if (await accounts.findByEmail(email))
                throw new EmailAlreadyRegistered();
            const account = await accounts.create(email, passwordHash);
            await profiles.createForAccount(account.id);
            return account;
        });
    }
}
