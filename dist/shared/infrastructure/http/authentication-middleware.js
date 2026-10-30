import { z } from 'zod';
const uuidSchema = z.string().uuid();
export function authenticationMiddleware(jwt) {
    return (req, res, next) => {
        const authorization = req.get('authorization');
        if (!authorization) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const match = /^Bearer ([^\s]+)$/i.exec(authorization);
        if (!match?.[1]) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        void jwt.verify(match[1]).then(claims => {
            if (!claims || !uuidSchema.safeParse(claims.sub).success) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            req.auth = { accountId: claims.sub };
            next();
        }).catch(next);
    };
}
