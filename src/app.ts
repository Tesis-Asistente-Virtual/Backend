import express from 'express';
import { errorHandler } from './shared/infrastructure/http/error-handler.js';
export const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(errorHandler);
