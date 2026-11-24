import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assessmentInstrumentQuestions, assessmentInstrumentVersions, dass21VersionPublicationAudit } from '../../src/modules/preliminary-assessment/infrastructure/persistence/schema.js';
import { DrizzleInstrumentCatalog } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { DASS21_INSTRUMENT_ID } from '../../src/modules/preliminary-assessment/application/internal/services/dass21-version-authorization-registry.js';
import { hashDass21QuestionSnapshot } from '../../src/modules/preliminary-assessment/application/internal/services/dass21-publication-manifest.js';
import { connectTestDatabase } from './test-database.js';

const run = promisify(execFile);
const hasTestDbUrl = Boolean(process.env.TEST_DATABASE_URL);
const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const versionId = randomUUID();
const instrumentVersion = `publication-it-${runId}`;
const questionDefs = Array.from({ length: 21 }, (_, index) => ({
  id: randomUUID(), prompt: `Synthetic publication test item ${index + 1}`, required: true,
  responseType: 'single_choice' as const, displayOrder: index + 1,
  options: Array.from({ length: 4 }, (_, value) => ({ id: `option-${value}`, label: `Synthetic ${value}`, scoringValue: value })),
}));

describe.skipIf(!hasTestDbUrl)('DASS-21 local publication operation (isolated synthetic fixture)', () => {
  let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
  let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
  let evidencePath: string;
  let manifestPath: string;
  let published = false;

  beforeAll(async () => {
    ({ pool, db } = await connectTestDatabase());
    const catalog = new DrizzleInstrumentCatalog(db);
    await catalog.createDraft({
      instrumentId: DASS21_INSTRUMENT_ID, instrumentVersionId: versionId, version: instrumentVersion,
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft', questions: questionDefs,
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    });
    evidencePath = `tests/integration/.dass21-publication-evidence-${runId}.txt`;
    manifestPath = `tests/integration/.dass21-publication-manifest-${runId}.json`;
    const evidenceText = 'SYNTHETIC TEST FIXTURE ONLY. Not an approval, authorization, license, or professional decision.';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(evidencePath, evidenceText, { flag: 'wx' });
    const evidence = {
      evidenceReference: 'synthetic integration fixture only; no real authorization',
      scope: 'tesis_test_db integration test only', responsible: 'synthetic test fixture', responsibleRole: 'automated test',
      authorizedAt: new Date(Date.now() - 60_000).toISOString(),
      documents: [{ reference: 'test-only marker', file: evidencePath, sha256: createHash('sha256').update(evidenceText).digest('hex') }],
    };
    const snapshot = questionDefs.map(question => {
      const { displayOrder, ...definition } = question;
      return { questionId: question.id, displayOrder, definition };
    });
    const manifest = {
      schemaVersion: '1.0', targetDatabase: 'tesis_test_db', operator: { name: 'synthetic test runner', role: 'automated test' },
      instrument: { instrumentCode: 'DASS-21', instrumentId: DASS21_INSTRUMENT_ID, instrumentVersionId: versionId,
        instrumentVersion, questionSetSha256: hashDass21QuestionSnapshot(snapshot) },
      administration: evidence,
      license: { status: 'not_applicable', reference: 'synthetic test fixture only', evidence },
      scoring: null, interpretation: null, participantDisclosure: null,
      effectiveAt: new Date(Date.now() - 30_000).toISOString(),
    };
    const { writeFile: writeManifest } = await import('node:fs/promises');
    await writeManifest(manifestPath, JSON.stringify(manifest), { flag: 'wx' });
  }, 15_000);

  afterAll(async () => {
    if (db && !published) {
      await db.delete(assessmentInstrumentQuestions).where(eq(assessmentInstrumentQuestions.instrumentVersionId, versionId));
      await db.delete(assessmentInstrumentVersions).where(eq(assessmentInstrumentVersions.instrumentVersionId, versionId));
    }
    const { rm } = await import('node:fs/promises');
    if (evidencePath) await rm(evidencePath, { force: true });
    if (manifestPath) await rm(manifestPath, { force: true });
    await pool?.end();
  });

  it('validates without writing, publishes once with an audit, and rejects invalid evidence, version identity, and repeat publication', async () => {
    const env = { ...process.env, DASS21_ADMIN_DATABASE_URL: process.env.TEST_DATABASE_URL };
    const invoke = async (manifest = manifestPath, publish = false, confirmVersion = versionId) => {
      const args = ['node_modules/tsx/dist/cli.mjs', 'scripts/publish-dass21-version.ts', '--manifest', manifest];
      if (publish) args.push('--publish', '--confirm', `tesis_test_db/${confirmVersion}`);
      try { return { ok: true as const, ...(await run(process.execPath, args, { cwd: process.cwd(), env })) }; }
      catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string; code?: number | string; signal?: string | null };
        return {
          ok: false as const,
          stdout: safeChildOutput(failure.stdout ?? ''),
          stderr: safeChildOutput(failure.stderr ?? failure.message ?? ''),
          exitCode: typeof failure.code === 'number' ? failure.code : null,
          processErrorCode: typeof failure.code === 'string' ? failure.code : null,
          signal: failure.signal ?? null,
        };
      }
    };

    const dryRun = await invoke();
    expect(dryRun.ok, dryRun.ok ? undefined : formatChildFailure('DASS-21 publication dry-run', dryRun)).toBe(true);
    expect(dryRun.stdout).toContain('validated_no_write');
    const [stillDraft] = await db.select({ status: assessmentInstrumentVersions.status }).from(assessmentInstrumentVersions)
      .where(eq(assessmentInstrumentVersions.instrumentVersionId, versionId));
    expect(stillDraft?.status).toBe('draft');

    const [storedQuestion] = await db.select({ questionId: assessmentInstrumentQuestions.questionId, definition: assessmentInstrumentQuestions.definition })
      .from(assessmentInstrumentQuestions).where(eq(assessmentInstrumentQuestions.instrumentVersionId, versionId)).limit(1);
    expect(storedQuestion).toBeDefined();
    if (!storedQuestion) throw new Error('Synthetic publication question fixture was not persisted');
    try {
      await db.update(assessmentInstrumentQuestions).set({ definition: { ...storedQuestion.definition, prompt: 'Tampered synthetic publication test item' } })
        .where(eq(assessmentInstrumentQuestions.questionId, storedQuestion.questionId));
      const changedQuestionDryRun = await invoke();
      expect(changedQuestionDryRun.ok).toBe(false);
      if (!changedQuestionDryRun.ok) expect(changedQuestionDryRun.stderr).toContain('Question-set SHA-256 does not match');
    } finally {
      await db.update(assessmentInstrumentQuestions).set({ definition: storedQuestion.definition })
        .where(eq(assessmentInstrumentQuestions.questionId, storedQuestion.questionId));
    }

    const { readFile, writeFile } = await import('node:fs/promises');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const invalidEvidenceManifest = JSON.parse(originalManifest) as {
      administration: { documents: Array<{ sha256: string }> };
    };
    invalidEvidenceManifest.administration.documents[0]!.sha256 = '0'.repeat(64);
    try {
      await writeFile(manifestPath, JSON.stringify(invalidEvidenceManifest));
      const invalidEvidence = await invoke(manifestPath, true);
      expect(invalidEvidence.ok).toBe(false);
      if (!invalidEvidence.ok) expect(invalidEvidence.stderr).toContain('Evidence hash mismatch');
    } finally {
      await writeFile(manifestPath, originalManifest);
    }

    const wrongVersionId = randomUUID();
    const wrongVersionManifest = JSON.parse(originalManifest) as { instrument: { instrumentVersionId: string } };
    wrongVersionManifest.instrument.instrumentVersionId = wrongVersionId;
    try {
      await writeFile(manifestPath, JSON.stringify(wrongVersionManifest));
      const wrongVersion = await invoke(manifestPath, true, wrongVersionId);
      expect(wrongVersion.ok).toBe(false);
      if (!wrongVersion.ok) expect(wrongVersion.stderr).toContain('Exact instrument version identity');
    } finally {
      await writeFile(manifestPath, originalManifest);
    }

    const publication = await invoke(manifestPath, true);
    expect(publication.ok).toBe(true);
    expect(publication.stdout).toContain('published_and_audited');
    published = true;
    const [publishedVersion] = await db.select({ status: assessmentInstrumentVersions.status }).from(assessmentInstrumentVersions)
      .where(eq(assessmentInstrumentVersions.instrumentVersionId, versionId));
    expect(publishedVersion?.status).toBe('approved');
    await expect(db.select().from(dass21VersionPublicationAudit).where(eq(dass21VersionPublicationAudit.instrumentVersionId, versionId)))
      .resolves.toHaveLength(1);
    let auditMutationError: unknown;
    try {
      await db.update(dass21VersionPublicationAudit).set({ operatorName: 'tampered' })
        .where(eq(dass21VersionPublicationAudit.instrumentVersionId, versionId));
    } catch (error) { auditMutationError = error; }
    expect(findSqlState(auditMutationError)).toBe('23514');

    const duplicate = await invoke(manifestPath, true);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.stderr).toContain('pending draft');
    await expect(db.select().from(dass21VersionPublicationAudit).where(eq(dass21VersionPublicationAudit.instrumentVersionId, versionId)))
      .resolves.toHaveLength(1);
  }, 45_000);
});

function safeChildOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\bBearer\s+[^\s'"<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .slice(0, 3000);
}

function formatChildFailure(label: string, failure: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  processErrorCode: string | null;
  signal: string | null;
}): string {
  return [
    `${label} failed (exitCode=${failure.exitCode ?? 'unavailable'}, processErrorCode=${failure.processErrorCode ?? 'none'}, signal=${failure.signal ?? 'none'})`,
    `stderr: ${failure.stderr || '(empty)'}`,
    `stdout: ${failure.stdout || '(empty)'}`,
  ].join('\n');
}

function findSqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return findSqlState(error.cause);
  return undefined;
}
