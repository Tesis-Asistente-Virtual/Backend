import { describe, expect, it } from 'vitest';
import { StagingDatabaseSafetyError, validateStagingDatabaseUrl } from '../../src/shared/infrastructure/database/staging-database-safety.js';
import { integratedStagingSyntheticNotices } from '../../src/staging/synthetic-consent-fixtures.js';
import { isSyntheticStagingEmail } from '../../src/staging/create-integrated-synthetic-staging-app.js';
import { isAllowedSyntheticStagingConversationInput, syntheticStagingConversationTitle, syntheticStagingUserMessage } from '../../src/modules/conversations/interfaces/rest/technical-staging-conversations-router.js';

describe('integrated synthetic staging guards', () => {
  it('accepts only an explicit loopback tesis_staging_db PostgreSQL URL', () => {
    expect(validateStagingDatabaseUrl('postgres://synthetic:fictional@127.0.0.1:5432/tesis_staging_db', 'development'))
      .toContain('/tesis_staging_db');
    for (const value of [undefined, 'not-a-url', 'https://localhost/tesis_staging_db',
      'postgres://u:p@remote.example/tesis_staging_db', 'postgres://u:p@localhost/testdb',
      'postgres://u:p@localhost/tesis_test_db', 'postgres://u:p@localhost/tesis_demo_db']) {
      expect(() => validateStagingDatabaseUrl(value, 'development')).toThrow(StagingDatabaseSafetyError);
    }
    expect(() => validateStagingDatabaseUrl('postgres://u:p@localhost/tesis_staging_db', 'production'))
      .toThrow(StagingDatabaseSafetyError);
  });

  it('restricts test account registration to the reserved example.test domain', () => {
    expect(isSyntheticStagingEmail('synthetic-01@example.test')).toBe(true);
    expect(isSyntheticStagingEmail('student@example.com')).toBe(false);
    expect(isSyntheticStagingEmail('synthetic@sub.example.test')).toBe(false);
  });

  it('accepts only the fixed synthetic chat content and title', () => {
    expect(isAllowedSyntheticStagingConversationInput('/', {})).toBe(true);
    expect(isAllowedSyntheticStagingConversationInput('/', { title: syntheticStagingConversationTitle })).toBe(true);
    expect(isAllowedSyntheticStagingConversationInput('/', { title: 'real name' })).toBe(false);
    expect(isAllowedSyntheticStagingConversationInput('/abc/messages', { content: syntheticStagingUserMessage })).toBe(true);
    expect(isAllowedSyntheticStagingConversationInput('/abc/messages', { content: 'personal story' })).toBe(false);
  });

  it('requires separate synthetic notices for chat, extraction, and assessment only', () => {
    expect(integratedStagingSyntheticNotices.map(notice => notice.purpose).sort()).toEqual([
      'ai_conversation_processing', 'preliminary_assessment', 'structured_signal_extraction',
    ]);
    expect(integratedStagingSyntheticNotices.every(notice => /SOLO PRUEBA TÉCNICA.*NO APROBACIÓN LEGAL.*DATOS FICTICIOS/.test(notice.content))).toBe(true);
  });

});
