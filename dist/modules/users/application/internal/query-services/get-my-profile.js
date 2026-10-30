export class ProfileNotFound extends Error {
}
export class GetMyProfile {
    profiles;
    constructor(profiles) {
        this.profiles = profiles;
    }
    async execute(accountId) {
        const profile = await this.profiles.findByAccountId(accountId);
        if (!profile)
            throw new ProfileNotFound();
        return profile;
    }
}
