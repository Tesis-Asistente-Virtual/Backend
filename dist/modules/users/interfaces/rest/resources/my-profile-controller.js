import { updateMyProfileSchema } from '../validation/update-my-profile-schema.js';
export class MyProfileController {
    getMyProfile;
    updateMyProfile;
    constructor(getMyProfile, updateMyProfile) {
        this.getMyProfile = getMyProfile;
        this.updateMyProfile = updateMyProfile;
    }
    async handle(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        res.status(200).json(await this.getMyProfile.execute(accountId));
    }
    async update(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!this.updateMyProfile)
            throw new Error('Profile update is not configured');
        const changes = updateMyProfileSchema.parse(req.body);
        res.status(200).json(await this.updateMyProfile.execute(accountId, changes));
    }
}
