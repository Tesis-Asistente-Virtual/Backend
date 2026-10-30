import type { Request, Response } from 'express';
import { SignUp } from '../../../application/internal/command-services/sign-up.js';

export class SignUpController {
  constructor(private readonly signUp: SignUp) {}

  async handle(req: Request, res: Response): Promise<void> {
    const account = await this.signUp.execute(req.body);
    res.status(201).json({
      id: account.id,
      email: account.email,
      message: 'Cuenta registrada correctamente',
    });
  }
}
