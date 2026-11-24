export class RecommendationsUnavailable extends Error { constructor() { super('Recommendations are unavailable'); this.name = 'RecommendationsUnavailable'; } }
export class RecommendationsConsentRequired extends Error { constructor() { super('Current recommendation consent is required'); this.name = 'RecommendationsConsentRequired'; } }
export class RecommendationsAnalysisUnavailable extends Error { constructor() { super('Source analysis is unavailable'); this.name = 'RecommendationsAnalysisUnavailable'; } }
export class RecommendationsGenerationInProgress extends Error { constructor() { super('Recommendation generation is already in progress'); this.name = 'RecommendationsGenerationInProgress'; } }
export class RecommendationsPersistenceConflict extends Error { constructor() { super('Recommendation generation could not be completed'); this.name = 'RecommendationsPersistenceConflict'; } }
