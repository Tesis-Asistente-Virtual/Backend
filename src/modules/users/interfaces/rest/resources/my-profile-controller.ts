import type { Request, Response } from 'express';
import { GetMyProfile } from '../../../application/internal/query-services/get-my-profile.js';
import { UpdateMyProfile } from '../../../application/internal/command-services/update-my-profile.js';
import { updateMyProfileSchema } from '../validation/update-my-profile-schema.js';
export class MyProfileController {
  constructor(private readonly getMyProfile: GetMyProfile, private readonly updateMyProfile?: UpdateMyProfile) {}
  async handle(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.status(200).json(await this.getMyProfile.execute(accountId));
  }
  async update(req: Request, res: Response): Promise<void> {
    const accountId = req.auth?.accountId;
    if (!accountId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!this.updateMyProfile) throw new Error('Profile update is not configured');
    const changes = updateMyProfileSchema.parse(req.body);
    res.status(200).json(await this.updateMyProfile.execute(accountId, changes));
  }
}
