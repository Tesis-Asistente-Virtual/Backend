import { describe, expect, it, vi } from 'vitest';
import { ArchiveActiveConversations } from '../../../src/modules/conversations/application/internal/command-services/archive-active-conversations.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';

const accountId = '9d5e2cc2-145d-4e52-b3c0-e3e2b02041a5';

describe('ArchiveActiveConversations', () => {
  it('archives every active conversation of the owner and reports how many', async () => {
    const repo = { archiveActiveForOwner: vi.fn(async () => 3) } as unknown as ConversationRepository;
    await expect(new ArchiveActiveConversations(repo).execute(accountId)).resolves.toBe(3);
    expect(repo.archiveActiveForOwner).toHaveBeenCalledWith(accountId);
  });

  it('rejects a malformed account id before touching the database', async () => {
    const repo = { archiveActiveForOwner: vi.fn(async () => 0) } as unknown as ConversationRepository;
    await expect(new ArchiveActiveConversations(repo).execute('no-es-uuid')).rejects.toThrow();
    expect(repo.archiveActiveForOwner).not.toHaveBeenCalled();
  });
});
