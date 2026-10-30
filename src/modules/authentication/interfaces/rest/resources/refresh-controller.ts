import type { Request, Response } from 'express';
import { RefreshSession } from '../../../application/internal/command-services/refresh-session.js';
export class RefreshController {
  constructor(private readonly refresh: RefreshSession) {}
  async handle(req: Request, res: Response): Promise<void> { res.status(200).json(await this.refresh.execute(req.body)); }
}
