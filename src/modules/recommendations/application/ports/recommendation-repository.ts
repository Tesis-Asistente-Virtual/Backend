import type { RecommendationSet, PersistedSourceAnalysis } from '../../domain/model/recommendation-set.js';

export type ReservationResult =
  | { readonly kind: 'claimed'; readonly recommendationSetId: string; readonly generationToken: string; readonly analysis: PersistedSourceAnalysis; readonly expiresAt: Date }
  | { readonly kind: 'existing'; readonly recommendations: RecommendationSet }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'unavailable' };

export interface RecommendationRepository {
  reserve(input: { accountId: string; analysisId?: string; now: Date; generationToken: string; leaseExpiresAt: Date }): Promise<ReservationResult>;
  complete(input: { accountId: string; analysisId: string; generationToken: string; now: Date; recommendations: RecommendationSet }): Promise<RecommendationSet | null>;
  release(input: { accountId: string; analysisId: string; generationToken: string }): Promise<void>;
  latest(input: { accountId: string; now: Date }): Promise<RecommendationSet | null>;
}
