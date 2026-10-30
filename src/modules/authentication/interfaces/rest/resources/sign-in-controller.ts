import type { Request, Response } from 'express';
import { SignIn } from '../../../application/internal/command-services/sign-in.js';

export class SignInController {
  constructor(private readonly signIn: SignIn) {}
  async handle(req: Request, res: Response): Promise<void> {
    res.status(200).json(await this.signIn.execute(req.body));
  }
}
