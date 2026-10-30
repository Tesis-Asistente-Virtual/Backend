import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { EmailAlreadyRegistered } from '../../../modules/authentication/application/internal/command-services/sign-up.js';
import { InvalidCredentials } from '../../../modules/authentication/application/internal/command-services/sign-in.js';
import { InvalidRefreshToken } from '../../../modules/authentication/application/internal/command-services/refresh-session.js';
import { ProfileNotFound } from '../../../modules/users/application/internal/query-services/get-my-profile.js';

function hasUniqueViolationCode(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request data' });
    return;
  }
  if (err instanceof EmailAlreadyRegistered || hasUniqueViolationCode(err)) {
    res.status(409).json({ error: 'Email is already registered' });
    return;
  }
  if (err instanceof InvalidCredentials || err instanceof InvalidRefreshToken) {
    res.status(401).json({ error: err instanceof InvalidCredentials ? 'Invalid email or password' : 'Invalid refresh token' });
    return;
  }
  if (err instanceof ProfileNotFound) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  console.error('Unhandled request error');
  res.status(500).json({ error: 'Internal server error' });
};
