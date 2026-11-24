import type { ConversationalSignalAnalysis } from '../model/conversational-signal-analysis.js';

export interface ConversationalSignalAnalysisRepository {
  saveForOwnerWithCurrentConsent(input: {
    analysis: ConversationalSignalAnalysis;
    expiresAt: Date;
    userMessageIds: readonly string[];
  }): Promise<ConversationalSignalAnalysis | null>;
  findLatestForOwnerWithCurrentConsent(accountId: string): Promise<ConversationalSignalAnalysis | null>;
  listRecentForOwnerWithCurrentConsent(accountId: string, limit: number): Promise<ConversationalSignalAnalysis[]>;
  purgeExpiredBatch(asOf: Date, limit: number, ownerAccountId?: string): Promise<number>;
}
