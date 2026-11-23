import type { Dass21QuestionMapping } from '../model/dass21-question-mapping.js';

/** Internal catalog port; it is not registered in a public route or application service. */
export interface Dass21QuestionMappingRepository {
  saveDraft(mapping: Dass21QuestionMapping): Promise<void>;
  freeze(mappingId: string, instrumentVersionId: string, mappingVersion: string, frozenAt: Date): Promise<Dass21QuestionMapping>;
  findFrozen(instrumentVersionId: string, mappingVersion: string): Promise<Dass21QuestionMapping | null>;
}
