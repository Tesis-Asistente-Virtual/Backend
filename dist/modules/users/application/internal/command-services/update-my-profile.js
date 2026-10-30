import { ProfileNotFound } from '../query-services/get-my-profile.js';
export class UpdateMyProfile {
    profiles;
    constructor(profiles) {
        this.profiles = profiles;
    }
    async execute(accountId, changes) {
        const profile = await this.profiles.updateByAccountId(accountId, changes);
        if (!profile)
            throw new ProfileNotFound();
        return profile;
    }
}
