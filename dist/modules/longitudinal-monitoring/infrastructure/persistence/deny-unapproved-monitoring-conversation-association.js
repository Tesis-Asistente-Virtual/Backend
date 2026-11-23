/** Production default: no notice version has been reviewed to cover this new association purpose. */
export class DenyUnapprovedMonitoringConversationAssociation {
    async isNoticeApprovedForAssociation(_noticeVersionId) {
        return false;
    }
}
