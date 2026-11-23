import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { isInstrumentAvailable, parseInstrumentVersion, type InstrumentAvailabilityPolicy } from '../../domain/model/instrument.js';
import { Dass21ScoringError } from '../../domain/model/dass21-scoring.js';
import { freezeDass21QuestionMapping, validateDass21QuestionMapping, type Dass21QuestionMapping } from '../../domain/model/dass21-question-mapping.js';
import type { Dass21QuestionMappingRepository } from '../../domain/repositories/dass21-question-mapping-repository.js';
import { assessmentInstrumentQuestions, assessmentInstrumentVersions, assessmentScoringItemMappings, assessmentScoringMappingVersions } from './schema.js';
import { enableTechnicalTestDraftForVersion } from './technical-test-draft-authorization.js';

type MappingVersionRow = typeof assessmentScoringMappingVersions.$inferSelect;
type MappingItemRow = typeof assessmentScoringItemMappings.$inferSelect;

function toMapping(row: MappingVersionRow, items: readonly MappingItemRow[]): Dass21QuestionMapping {
  return {
    schemaVersion: '1.0', mappingId: row.mappingId, instrumentCode: 'DASS-21', instrumentId: row.instrumentId,
    instrumentVersionId: row.instrumentVersionId, mappingVersion: row.mappingVersion, status: row.status,
    createdAt: row.createdAt, frozenAt: row.frozenAt,
    entries: items.map(item => ({ questionId: item.questionId, itemNumber: item.itemNumber })),
  };
}

async function readInstrument(
  executor: NodePgDatabase<typeof schema> | Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0],
  instrumentVersionId: string,
) {
  const [row] = await executor.select().from(assessmentInstrumentVersions)
    .where(eq(assessmentInstrumentVersions.instrumentVersionId, instrumentVersionId)).limit(1);
  if (!row) throw new Dass21ScoringError('invalid_instrument');
  const questions = await executor.select().from(assessmentInstrumentQuestions)
    .where(eq(assessmentInstrumentQuestions.instrumentVersionId, instrumentVersionId));
  return parseInstrumentVersion({
    instrumentId: row.instrumentId, instrumentVersionId: row.instrumentVersionId, version: row.version,
    effectiveAt: row.effectiveAt, status: row.status, questions: questions.map(question => ({
      ...(typeof question.definition === 'object' && question.definition !== null ? question.definition : {}),
      ...(question.displayOrder === null ? {} : { displayOrder: question.displayOrder }),
    })),
    approval: { status: row.approvalStatus, approvedAt: row.approvedAt, approvalReference: row.approvalReference },
    license: { status: row.licenseStatus, reference: row.licenseReference },
  });
}

export class DrizzleDass21QuestionMappingRepository implements Dass21QuestionMappingRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
    private readonly technicalTestInstrumentVersionId?: string,
  ) {}

  async saveDraft(mappingValue: Dass21QuestionMapping): Promise<void> {
    if (mappingValue.status !== 'draft' || mappingValue.frozenAt !== null) throw new Dass21ScoringError('invalid_instrument');
    await this.db.transaction(async tx => {
      const [instrumentRow] = await tx.select({ id: assessmentInstrumentVersions.instrumentVersionId })
        .from(assessmentInstrumentVersions)
        .where(eq(assessmentInstrumentVersions.instrumentVersionId, mappingValue.instrumentVersionId)).for('update').limit(1);
      if (!instrumentRow) throw new Dass21ScoringError('invalid_instrument');
      const instrument = await readInstrument(tx, mappingValue.instrumentVersionId);
      const mapping = validateDass21QuestionMapping(mappingValue, instrument, this.availability, mappingValue.createdAt);
      await tx.insert(assessmentScoringMappingVersions).values({
        mappingId: mapping.mappingId, instrumentId: mapping.instrumentId, instrumentVersionId: mapping.instrumentVersionId,
        mappingVersion: mapping.mappingVersion, status: 'draft', createdAt: mapping.createdAt, frozenAt: null,
      });
      if (mapping.entries.length !== 21) throw new Dass21ScoringError('invalid_instrument');
      await tx.insert(assessmentScoringItemMappings).values(mapping.entries.map(entry => ({
        mappingId: mapping.mappingId, instrumentId: mapping.instrumentId,
        instrumentVersionId: mapping.instrumentVersionId, questionId: entry.questionId, itemNumber: entry.itemNumber,
      })));
    }).catch(error => {
      if (error instanceof Dass21ScoringError) throw error;
      throw new Dass21ScoringError('mapping_conflict');
    });
  }

  async freeze(mappingId: string, instrumentVersionId: string, mappingVersion: string, frozenAt: Date): Promise<Dass21QuestionMapping> {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(assessmentScoringMappingVersions).where(and(
        eq(assessmentScoringMappingVersions.mappingId, mappingId),
        eq(assessmentScoringMappingVersions.instrumentVersionId, instrumentVersionId),
        eq(assessmentScoringMappingVersions.mappingVersion, mappingVersion),
      )).for('update').limit(1);
      if (!row) throw new Dass21ScoringError('mapping_not_found');
      const items = await tx.select().from(assessmentScoringItemMappings).where(eq(assessmentScoringItemMappings.mappingId, mappingId));
      const mapping = toMapping(row, items);
      const instrument = await readInstrument(tx, instrumentVersionId);
      const authorized = validateDass21QuestionMapping(mapping, instrument, this.availability, frozenAt);
      const frozen = freezeDass21QuestionMapping(authorized, frozenAt);
      await enableTechnicalTestDraftForVersion(tx, this.technicalTestInstrumentVersionId, instrumentVersionId);
      const [updated] = await tx.update(assessmentScoringMappingVersions).set({ status: 'frozen', frozenAt })
        .where(and(eq(assessmentScoringMappingVersions.mappingId, mappingId), eq(assessmentScoringMappingVersions.status, 'draft')))
        .returning();
      if (!updated) throw new Dass21ScoringError('mapping_not_frozen');
      return frozen;
    }).catch(error => {
      if (error instanceof Dass21ScoringError) throw error;
      throw new Dass21ScoringError('mapping_not_frozen');
    });
  }

  async findFrozen(instrumentVersionId: string, mappingVersion: string): Promise<Dass21QuestionMapping | null> {
    const [row] = await this.db.select().from(assessmentScoringMappingVersions).where(and(
      eq(assessmentScoringMappingVersions.instrumentVersionId, instrumentVersionId),
      eq(assessmentScoringMappingVersions.mappingVersion, mappingVersion),
      eq(assessmentScoringMappingVersions.status, 'frozen'),
    )).limit(1);
    if (!row) return null;
    const [items, instrument] = await Promise.all([
      this.db.select().from(assessmentScoringItemMappings).where(eq(assessmentScoringItemMappings.mappingId, row.mappingId)),
      readInstrument(this.db, instrumentVersionId),
    ]);
    return validateDass21QuestionMapping(toMapping(row, items), instrument, this.availability, new Date());
  }
}
