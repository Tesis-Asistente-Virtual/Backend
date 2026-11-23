import { z } from 'zod';
export const monitoringConversationAssociationContractVersion = '1.0';
export const monitoringConversationAssociationSchema = z.object({
    contractVersion: z.literal(monitoringConversationAssociationContractVersion),
    associationId: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    monitoringSessionId: z.string().uuid(),
    conversationId: z.string().uuid(),
    accountId: z.string().uuid(),
    createdAt: z.date(),
}).strict();
export function parseMonitoringConversationAssociation(value) {
    const parsed = monitoringConversationAssociationSchema.safeParse(value);
    if (!parsed.success)
        throw new MonitoringConversationAssociationDomainError('invalid_association');
    return parsed.data;
}
export class MonitoringConversationAssociationDomainError extends Error {
    code;
    constructor(code) {
        super('Monitoring conversation association is invalid');
        this.code = code;
        this.name = 'MonitoringConversationAssociationDomainError';
    }
}
