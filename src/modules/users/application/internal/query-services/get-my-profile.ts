import type { UserProfileRepository } from '../../../domain/repositories/user-profile-repository.js';
export class ProfileNotFound extends Error {}
export class GetMyProfile {
  constructor(private readonly profiles: UserProfileRepository) {}
  async execute(accountId: string) {
    const profile = await this.profiles.findByAccountId(accountId);
    if (!profile) throw new ProfileNotFound();
    return profile;
  }
}
