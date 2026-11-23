export function toMonitoringEnrollmentResource(value) {
    return {
        id: value.enrollmentId,
        status: value.status,
        contractVersion: value.contractVersion,
        consentedAt: value.consentedAt.toISOString(),
        enrolledAt: value.enrolledAt.toISOString(),
        statusChangedAt: value.statusChangedAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
        revision: value.revision,
    };
}
export function toMonitoringSessionResource(value) {
    return {
        id: value.sessionId,
        enrollmentId: value.enrollmentId,
        status: value.status,
        openedAt: value.openedAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
        closedAt: value.closedAt?.toISOString() ?? null,
        revision: value.revision,
    };
}
export function toMonitoringConversationAssociationResource(value) {
    return {
        id: value.associationId,
        contractVersion: value.contractVersion,
        enrollmentId: value.enrollmentId,
        monitoringSessionId: value.monitoringSessionId,
        conversationId: value.conversationId,
        createdAt: value.createdAt.toISOString(),
    };
}
export function toMonitoringPageResource(items, toResource, limit, offset) {
    return { items: items.slice(0, limit).map(toResource), pagination: { limit, offset, hasMore: items.length > limit } };
}
