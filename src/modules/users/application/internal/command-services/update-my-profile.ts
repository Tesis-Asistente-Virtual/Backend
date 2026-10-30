import type { UserProfileRepository } from '../../../domain/repositories/user-profile-repository.js';
import { ProfileNotFound } from '../query-services/get-my-profile.js';

export type UpdateMyProfileInput = { firstName?: string | null; lastName?: string | null; phone?: string | null };
export class UpdateMyProfile {
  constructor(private readonly profiles: UserProfileRepository) {}
  async execute(accountId: string, changes: UpdateMyProfileInput) {
    const profile = await this.profiles.updateByAccountId(accountId, changes);
    if (!profile) throw new ProfileNotFound();
    return profile;
  }
}
