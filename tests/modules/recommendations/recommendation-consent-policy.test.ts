import { describe, expect, it } from 'vitest';
import { recommendationConsentPurposes, resolveCurrentRecommendationConsentNotice } from '../../../src/modules/recommendations/application/recommendation-consent-policy.js';

const granted = recommendationConsentPurposes.map(purpose => ({ purpose, currentNoticeId: `${purpose}-v1`, latestAction: 'granted', latestNoticeId: `${purpose}-v1` }));

describe('recommendation consent policy', () => {
  it('requires all four current, published notice grants and returns recommendation notice ID', () => {
    expect(resolveCurrentRecommendationConsentNotice(granted)).toBe('wellbeing_recommendations-v1');
  });
  it('fails closed for missing, withdrawn, or replaced notices', () => {
    expect(resolveCurrentRecommendationConsentNotice(granted.slice(1))).toBeNull();
    expect(resolveCurrentRecommendationConsentNotice(granted.map(item => item.purpose === 'wellbeing_recommendations' ? { ...item, latestAction: 'withdrawn' } : item))).toBeNull();
    expect(resolveCurrentRecommendationConsentNotice(granted.map(item => item.purpose === 'wellbeing_recommendations' ? { ...item, currentNoticeId: 'wellbeing_recommendations-v2' } : item))).toBeNull();
  });
});
