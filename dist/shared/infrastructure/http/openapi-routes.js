import { Router } from 'express';
import { env } from '../../../config/env.js';
import { openApiDocument } from './openapi-document.js';
const router = Router();
const enabled = process.env.NODE_ENV !== 'production' || env.openApiEnabled;
if (enabled) {
    router.get('/api-docs.json', (_req, res) => res.json(openApiDocument));
    router.get('/api-docs', (_req, res) => {
        res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Backend API - Asistente Virtual de Tesis</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api-docs.json',dom_id:'#swagger-ui',deepLinking:true})</script></body></html>`);
    });
}
export const openApiRouter = router;
