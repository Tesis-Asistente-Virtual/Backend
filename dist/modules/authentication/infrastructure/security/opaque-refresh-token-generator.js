import { createHash, randomBytes } from 'node:crypto';
export class OpaqueRefreshTokenGenerator {
    generate() {
        const token = randomBytes(48).toString('base64url');
        const hash = createHash('sha256').update(token).digest('hex');
        return { token, hash };
    }
    hash(token) {
        return createHash('sha256').update(token).digest('hex');
    }
}
