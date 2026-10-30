import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { UpdateMyProfile } from '../../../src/modules/users/application/internal/command-services/update-my-profile.js';
import { ProfileNotFound } from '../../../src/modules/users/application/internal/query-services/get-my-profile.js';
import { MyProfileController } from '../../../src/modules/users/interfaces/rest/resources/my-profile-controller.js';
import { updateMyProfileSchema } from '../../../src/modules/users/interfaces/rest/validation/update-my-profile-schema.js';
import type { UserProfileRepository } from '../../../src/modules/users/domain/repositories/user-profile-repository.js';

const owner = '550e8400-e29b-41d4-a716-446655440000';
function setup(initial: { firstName: string | null; lastName: string | null; phone: string | null } | null = { firstName: 'Ana', lastName: 'Diaz', phone: '987654321' }) {
  let current = initial;
  const repository: UserProfileRepository = {
    createForAccount: vi.fn(async () => {}),
    findByAccountId: vi.fn(async () => current),
    updateByAccountId: vi.fn(async (accountId, changes) => {
      if (accountId !== owner || !current) return null;
      current = { ...current, ...changes };
      return current;
    }),
  };
  return { repository, useCase: new UpdateMyProfile(repository) };
}

describe('UpdateMyProfile', () => {
  it('updates provided fields while retaining omitted fields', async () => {
    const h = setup();
    await expect(h.useCase.execute(owner, updateMyProfileSchema.parse({ firstName: ' Carlos ' }))).resolves.toEqual({ firstName: 'Carlos', lastName: 'Diaz', phone: '987654321' });
    expect(h.repository.updateByAccountId).toHaveBeenCalledWith(owner, { firstName: 'Carlos' });
  });
  it('allows clearing an optional field with null', async () => {
    const h = setup();
    await expect(h.useCase.execute(owner, updateMyProfileSchema.parse({ phone: null }))).resolves.toMatchObject({ phone: null });
  });
  it('rejects invalid names, phone, unknown properties, and empty objects', () => {
    for (const value of [{ firstName: '   ' }, { firstName: 'x'.repeat(101) }, { phone: 'abc' }, { email: 'nope' }, {}]) {
      expect(() => updateMyProfileSchema.parse(value)).toThrow(ZodError);
    }
  });
  it('returns not found rather than creating a missing profile', async () => {
    const h = setup(null);
    await expect(h.useCase.execute(owner, { firstName: 'New' })).rejects.toBeInstanceOf(ProfileNotFound);
    expect(h.repository.createForAccount).not.toHaveBeenCalled();
  });
  it('uses only the authenticated account id and rejects an unauthenticated request', async () => {
    const h = setup();
    const controller = new MyProfileController({ execute: vi.fn() } as never, h.useCase);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await controller.update({ auth: { accountId: owner }, body: { firstName: 'Carl', accountId: 'attacker' } } as never, response as never).catch(error => expect(error).toBeInstanceOf(ZodError));
    expect(h.repository.updateByAccountId).not.toHaveBeenCalled();
    await controller.update({ body: { firstName: 'Carl' } } as never, response as never);
    expect(response.status).toHaveBeenCalledWith(401);
  });
});
