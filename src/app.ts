import express from 'express';
import { errorHandler } from './shared/infrastructure/http/error-handler.js';
import { authenticationRouter } from './modules/authentication/interfaces/rest/sign-up-routes.js';
export const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authenticationRouter);
app.use(errorHandler);
