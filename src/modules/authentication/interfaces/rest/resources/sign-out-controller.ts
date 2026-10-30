import type { Request, Response } from 'express';
import { SignOut } from '../../../application/internal/command-services/sign-out.js';
export class SignOutController {
  constructor(private readonly signOut: SignOut) {}
  async handle(req: Request, res: Response): Promise<void> { await this.signOut.execute(req.body); res.status(204).end(); }
}
