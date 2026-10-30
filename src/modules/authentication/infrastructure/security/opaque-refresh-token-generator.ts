import { createHash, randomBytes } from 'node:crypto';
import type { RefreshTokenGenerator } from '../../application/internal/command-services/sign-in.js';

export class OpaqueRefreshTokenGenerator implements RefreshTokenGenerator {
  generate() {
    const token = randomBytes(48).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
