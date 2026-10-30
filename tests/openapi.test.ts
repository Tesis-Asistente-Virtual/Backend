import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/shared/infrastructure/http/openapi-document.js';

describe('OpenAPI document', () => {
  it('generates OpenAPI 3.0 documentation for all seven existing endpoints', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
    const operations = Object.values(openApiDocument.paths).flatMap(path => Object.keys(path));
    expect(operations).toHaveLength(7);
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-up');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-in');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/refresh');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/auth/sign-out');
    expect(openApiDocument.paths).toHaveProperty('/api/v1/users/me');
    expect(openApiDocument.paths).toHaveProperty('/health');
    expect(openApiDocument.components.schemas).toHaveProperty('SignUpRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('UpdateMyProfileRequest');
  });
  it('marks both private profile operations as Bearer protected', () => {
    const mePath = openApiDocument.paths['/api/v1/users/me'];
    expect(mePath.get.security).toEqual([{ bearerAuth: [] }]);
    expect(mePath.patch.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  });
});
