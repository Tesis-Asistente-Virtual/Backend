import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/shared/infrastructure/http/openapi-document.js';

describe('OpenAPI document', () => {
  it('generates OpenAPI 3.0 documentation for all sixteen operations', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
    const operations = Object.values(openApiDocument.paths).flatMap(path => Object.keys(path));
    expect(operations).toHaveLength(16);
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
    expect(openApiDocument.paths).toHaveProperty('/health');
    expect(openApiDocument.components.schemas).toHaveProperty('SignUpRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('UpdateMyProfileRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('CreateConversationRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('ConversationMessagePageResponse');
    expect(openApiDocument.components.schemas).toHaveProperty('SendConversationMessageRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('SentConversationTurnResponse');
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
});
