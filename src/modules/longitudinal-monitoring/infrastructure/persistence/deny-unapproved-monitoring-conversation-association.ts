import type { MonitoringConversationAssociationScope } from '../../application/ports/monitoring-conversation-association-scope.js';

/** Production default: no notice version has been reviewed to cover this new association purpose. */
export class DenyUnapprovedMonitoringConversationAssociation implements MonitoringConversationAssociationScope {
  async isNoticeApprovedForAssociation(_noticeVersionId: string): Promise<boolean> {
    return false;
  }
}
