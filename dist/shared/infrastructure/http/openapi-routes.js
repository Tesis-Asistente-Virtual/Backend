import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from '../../../config/env.js';
import { openApiDocument } from './openapi-document.js';
const router = Router();
const enabled = process.env.NODE_ENV !== 'production' || env.openApiEnabled;
if (enabled) {
    router.get('/api-docs.json', (_req, res) => res.json(openApiDocument));
    router.use('/api-docs', swaggerUi.serve);
    router.get('/api-docs', swaggerUi.setup(null, {
        customSiteTitle: 'Backend API - Asistente Virtual de Tesis',
        swaggerOptions: { url: '/api-docs.json', deepLinking: true },
    }));
}
export const openApiRouter = router;
