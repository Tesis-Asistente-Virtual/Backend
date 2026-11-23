import { composePreliminaryAssessmentRouter } from './preliminary-assessment-router-composition.js';
/** Standard approved-only router used by the normal application composition. */
export function createPreliminaryAssessmentRouter(database, jwt) {
    return composePreliminaryAssessmentRouter(database, jwt);
}
