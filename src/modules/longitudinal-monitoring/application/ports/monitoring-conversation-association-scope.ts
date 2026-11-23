/** Only an explicitly reviewed notice version may authorize linking conversation metadata to monitoring. */
export interface MonitoringConversationAssociationScope {
  isNoticeApprovedForAssociation(noticeVersionId: string): Promise<boolean>;
}
