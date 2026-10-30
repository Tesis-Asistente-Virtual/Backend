import { ZodError } from 'zod';
import { EmailAlreadyRegistered } from '../../../modules/authentication/application/internal/command-services/sign-up.js';
function hasUniqueViolationCode(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
export const errorHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid request data' });
        return;
    }
    if (err instanceof EmailAlreadyRegistered || hasUniqueViolationCode(err)) {
        res.status(409).json({ error: 'Email is already registered' });
        return;
    }
    console.error('Unhandled request error');
    res.status(500).json({ error: 'Internal server error' });
};
