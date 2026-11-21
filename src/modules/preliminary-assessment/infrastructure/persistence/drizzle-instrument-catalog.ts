import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { isInstrumentAvailable, parseInstrumentVersion, type InstrumentVersion } from '../../domain/model/instrument.js';
import type { InstrumentCatalog, InstrumentPublication, NewInstrumentDraft } from '../../domain/repositories/instrument-catalog.js';
import { assessmentInstrumentQuestions, assessmentInstrumentVersions } from './schema.js';

type InstrumentRow = typeof assessmentInstrumentVersions.$inferSelect;

function toDomain(row: InstrumentRow, questions: readonly unknown[]): InstrumentVersion {
  return parseInstrumentVersion({
    instrumentId: row.instrumentId,
    instrumentVersionId: row.instrumentVersionId,
    version: row.version,
    effectiveAt: row.effectiveAt,
    status: row.status,
    questions,
    approval: { status: row.approvalStatus, approvedAt: row.approvedAt, approvalReference: row.approvalReference },
    license: { status: row.licenseStatus, reference: row.licenseReference },
  });
}

function draftValues(instrument: NewInstrumentDraft) {
  const parsed = parseInstrumentVersion(instrument);
  if (parsed.status !== 'draft') throw new PreliminaryAssessmentError('instrument_unavailable');
  return {
    instrumentVersionId: parsed.instrumentVersionId,
    instrumentId: parsed.instrumentId,
    version: parsed.version,
    status: parsed.status,
    approvalStatus: parsed.approval.status,
    approvedAt: parsed.approval.approvedAt,
    approvalReference: parsed.approval.approvalReference,
    licenseStatus: parsed.license.status,
    licenseReference: parsed.license.reference,
    effectiveAt: parsed.effectiveAt,
  };
}

export class DrizzleInstrumentCatalog implements InstrumentCatalog {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createDraft(instrument: NewInstrumentDraft): Promise<void> {
    const values = draftValues(instrument);
    await this.db.transaction(async tx => {
      await tx.insert(assessmentInstrumentVersions).values(values);
      if (instrument.questions.length > 0) await tx.insert(assessmentInstrumentQuestions).values(instrument.questions.map(question => ({
        instrumentVersionId: instrument.instrumentVersionId, questionId: question.id, definition: question,
      })));
    });
  }

  async updateDraft(instrument: NewInstrumentDraft): Promise<boolean> {
    const values = draftValues(instrument);
    return this.db.transaction(async tx => {
      const [draft] = await tx.select({ id: assessmentInstrumentVersions.instrumentVersionId })
        .from(assessmentInstrumentVersions)
        .where(and(eq(assessmentInstrumentVersions.instrumentVersionId, values.instrumentVersionId), eq(assessmentInstrumentVersions.status, 'draft')))
        .for('update').limit(1);
      if (!draft) return false;
      await tx.update(assessmentInstrumentVersions).set({
        instrumentId: values.instrumentId, version: values.version, approvalStatus: values.approvalStatus,
        approvedAt: values.approvedAt, approvalReference: values.approvalReference,
        licenseStatus: values.licenseStatus, licenseReference: values.licenseReference,
        effectiveAt: values.effectiveAt, updatedAt: new Date(),
      }).where(eq(assessmentInstrumentVersions.instrumentVersionId, values.instrumentVersionId));
      await tx.delete(assessmentInstrumentQuestions).where(eq(assessmentInstrumentQuestions.instrumentVersionId, values.instrumentVersionId));
      if (instrument.questions.length > 0) await tx.insert(assessmentInstrumentQuestions).values(instrument.questions.map(question => ({
        instrumentVersionId: instrument.instrumentVersionId, questionId: question.id, definition: question,
      })));
      return true;
    });
  }

  async publishVersion(versionId: string, publication: InstrumentPublication): Promise<InstrumentVersion | null> {
    return this.db.transaction(async tx => {
      const [draft] = await tx.select().from(assessmentInstrumentVersions)
        .where(eq(assessmentInstrumentVersions.instrumentVersionId, versionId)).for('update').limit(1);
      if (!draft || draft.status !== 'draft') return null;
      const questionRows = await tx.select().from(assessmentInstrumentQuestions)
        .where(eq(assessmentInstrumentQuestions.instrumentVersionId, versionId)).orderBy(asc(assessmentInstrumentQuestions.questionId));
      const candidate = toDomain({
        ...draft,
        status: 'approved',
        approvalStatus: publication.approval.status,
        approvedAt: publication.approval.approvedAt,
        approvalReference: publication.approval.approvalReference,
        licenseStatus: publication.license.status,
        licenseReference: publication.license.reference,
        effectiveAt: publication.effectiveAt,
      }, questionRows.map(item => item.definition));
      if (!isInstrumentAvailable(candidate)) throw new PreliminaryAssessmentError('instrument_unavailable');
      const [published] = await tx.update(assessmentInstrumentVersions).set({
        status: candidate.status,
        approvalStatus: candidate.approval.status,
        approvedAt: candidate.approval.approvedAt,
        approvalReference: candidate.approval.approvalReference,
        licenseStatus: candidate.license.status,
        licenseReference: candidate.license.reference,
        effectiveAt: candidate.effectiveAt,
        updatedAt: new Date(),
      }).where(and(
        eq(assessmentInstrumentVersions.instrumentVersionId, versionId),
        eq(assessmentInstrumentVersions.status, 'draft'),
      )).returning();
      return published ? candidate : null;
    });
  }

  async findVersion(instrumentId: string, versionId: string): Promise<InstrumentVersion | null> {
    const [row] = await this.db.select().from(assessmentInstrumentVersions).where(and(
      eq(assessmentInstrumentVersions.instrumentId, instrumentId),
      eq(assessmentInstrumentVersions.instrumentVersionId, versionId),
    )).limit(1);
    if (!row) return null;
    const questions = await this.db.select().from(assessmentInstrumentQuestions)
      .where(eq(assessmentInstrumentQuestions.instrumentVersionId, row.instrumentVersionId)).orderBy(asc(assessmentInstrumentQuestions.questionId));
    return toDomain(row, questions.map(item => item.definition));
  }

  async findAvailableByVersionId(versionId: string, at: Date): Promise<InstrumentVersion | null> {
    const [row] = await this.db.select().from(assessmentInstrumentVersions).where(and(
      eq(assessmentInstrumentVersions.instrumentVersionId, versionId),
      eq(assessmentInstrumentVersions.status, 'approved'),
      lte(assessmentInstrumentVersions.effectiveAt, at),
      lte(assessmentInstrumentVersions.approvedAt, at),
    )).limit(1);
    if (!row) return null;
    const questions = await this.db.select().from(assessmentInstrumentQuestions)
      .where(eq(assessmentInstrumentQuestions.instrumentVersionId, row.instrumentVersionId)).orderBy(asc(assessmentInstrumentQuestions.questionId));
    const candidate = toDomain(row, questions.map(item => item.definition));
    return isInstrumentAvailable(candidate) ? candidate : null;
  }

  async listAvailable(limit: number, offset: number, at: Date): Promise<readonly InstrumentVersion[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new PreliminaryAssessmentError('instrument_unavailable');
    }
    const rows = await this.db.select().from(assessmentInstrumentVersions).where(and(
      eq(assessmentInstrumentVersions.status, 'approved'),
      lte(assessmentInstrumentVersions.effectiveAt, at),
      lte(assessmentInstrumentVersions.approvedAt, at),
    )).orderBy(asc(assessmentInstrumentVersions.instrumentId), asc(assessmentInstrumentVersions.version))
      .limit(limit).offset(offset);
    if (rows.length === 0) return [];
    const questionRows = await this.db.select().from(assessmentInstrumentQuestions)
      .where(inArray(assessmentInstrumentQuestions.instrumentVersionId, rows.map(row => row.instrumentVersionId)))
      .orderBy(asc(assessmentInstrumentQuestions.questionId));
    const byVersion = new Map<string, unknown[]>();
    for (const question of questionRows) {
      const list = byVersion.get(question.instrumentVersionId) ?? [];
      list.push(question.definition);
      byVersion.set(question.instrumentVersionId, list);
    }
    return rows.map(row => toDomain(row, byVersion.get(row.instrumentVersionId) ?? [])).filter(isInstrumentAvailable);
  }
}
