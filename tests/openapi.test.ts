import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { openApiDocument } from '../src/shared/infrastructure/http/openapi-document.js';
import swaggerUi from 'swagger-ui-express';

const require = createRequire(import.meta.url);

describe('OpenAPI document', () => {
  it('generates OpenAPI 3.0 documentation for all forty-six operations', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
    const operations = Object.values(openApiDocument.paths).flatMap(path => Object.keys(path));
    expect(operations).toHaveLength(46);
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-up');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-in');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/refresh');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-out');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/users/me');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/conversations');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/conversations/{id}');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/conversations/{id}/messages');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/conversations/{id}/messages/stream');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/consents/notices');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/consents/me');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/consents/me/decisions');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/info');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/form');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/reauthorize');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/responses');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/pause');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/resume');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/withdraw');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/complete');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/result');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/monitoring/info');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/monitoring/enrollments');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/monitoring/enrollments/{id}/sessions');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/monitoring/enrollments/{id}/sessions/{sessionId}/conversation');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/me/recommendations/generate');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/me/recommendations/latest');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/me/psychological-referrals');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/me/psychological-referrals/{id}');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/me/psychological-referrals/{id}/send');
    expect(openApiDocument.paths).toHaveProperty('/health');
    expect(openApiDocument.components.schemas).toHaveProperty('SignUpRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('UpdateMyProfileRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('CreateConversationRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('ConversationMessagePageResponse');
    expect(openApiDocument.components.schemas).toHaveProperty('SendConversationMessageRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('SentConversationTurnResponse');
    expect(openApiDocument.components.schemas).toHaveProperty('StartAssessmentRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('AssessmentResult');
    expect(openApiDocument.components.schemas).toHaveProperty('AssessmentForm');
    expect(openApiDocument.components.schemas).toHaveProperty('MonitoringInfo');
    expect(openApiDocument.components.schemas).toHaveProperty('MonitoringEnrollment');
    expect(openApiDocument.components.schemas).toHaveProperty('MonitoringSession');
    expect(openApiDocument.components.schemas).toHaveProperty('GenerateRecommendationsRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('RecommendationResponse');
    expect(openApiDocument.components.schemas).toHaveProperty('CreatePsychologicalReferralRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('PsychologicalReferralPreview');
  });
  it('marks both private profile operations as Bearer protected', () => {
    const mePath = openApiDocument.paths['/api/v1/users/me'];
    expect(mePath.get.security).toEqual([{ bearerAuth: [] }]);
    expect(mePath.patch.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  });
  it('marks every conversation operation as Bearer protected', () => {
    expect(openApiDocument.paths['/api/v1/conversations'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/conversations'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/conversations/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/conversations/{id}/messages'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/conversations/{id}/messages'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/conversations/{id}/messages/stream'].post.security).toEqual([{ bearerAuth: [] }]);
  });
  it('documents every SSE stream.error code currently emitted by the controller', () => {
    const response = openApiDocument.paths['/api/v1/conversations/{id}/messages/stream'].post.responses['200'];
    const examples = response.content['text/event-stream'].examples;
    expect(examples).toHaveProperty('error');
    expect(examples).toHaveProperty('persistenceFailed');
    expect(examples).toHaveProperty('consentRequired');
    expect(examples).toHaveProperty('consentUnavailable');
    expect(examples).toHaveProperty('internalError');
    expect(Object.values(examples).filter(example => example.value.includes('event: stream.error'))).toHaveLength(5);
  });
  it('marks every preliminary assessment operation as Bearer protected', () => {
    for (const [path, item] of Object.entries(openApiDocument.paths).filter(([path]) => path.startsWith('/api/v1/preliminary-assessments'))) {
      for (const operation of Object.values(item)) expect(operation.security, path).toEqual([{ bearerAuth: [] }]);
    }
  });
  it('marks recommendations operations as Bearer protected', () => {
    expect(openApiDocument.paths['/api/v1/me/recommendations/generate'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/me/recommendations/latest'].get.security).toEqual([{ bearerAuth: [] }]);
  });
  it('marks psychological referral operations as Bearer protected', () => {
    expect(openApiDocument.paths['/api/v1/me/psychological-referrals'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/me/psychological-referrals/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/me/psychological-referrals/{id}'].delete.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/api/v1/me/psychological-referrals/{id}/send'].post.security).toEqual([{ bearerAuth: [] }]);
  });

  it('generates local Swagger asset URLs and includes the installed CSS and JS bundles', () => {
    const html = swaggerUi.generateHTML(null, {
      customSiteTitle: 'Backend API - Asistente Virtual de Tesis',
      swaggerOptions: { url: '/api-docs.json', deepLinking: true },
    });
    expect(html).toContain('./swagger-ui.css');
    expect(html).toContain('./swagger-ui-bundle.js');
    expect(html).toContain('./swagger-ui-init.js');
    expect(html).not.toContain('unpkg.com');

    const cssPath = require.resolve('swagger-ui-dist/swagger-ui.css');
    const bundlePath = require.resolve('swagger-ui-dist/swagger-ui-bundle.js');
    expect(statSync(cssPath).size).toBeGreaterThan(1000);
    expect(statSync(bundlePath).size).toBeGreaterThan(1000);
    expect(readFileSync(bundlePath, 'utf8')).toContain('SwaggerUIBundle');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/preliminary-assessments/{id}/complete');
  });
});
