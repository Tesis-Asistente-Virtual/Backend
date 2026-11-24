import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { DASS21_INSTRUMENT_ID } from '../src/modules/preliminary-assessment/application/internal/services/dass21-version-authorization-registry.js';
import {
  dass21PublicationManifestSchema,
  hashDass21QuestionSnapshot,
  toDass21QuestionSnapshot,
  toDass21RuntimeAuthorization,
  type Dass21PublicationManifest,
} from '../src/modules/preliminary-assessment/application/internal/services/dass21-publication-manifest.js';
import { isAllowedLoopbackAddress } from '../src/shared/infrastructure/database/test-database-safety.js';
import { isInstrumentAvailable, parseInstrumentVersion } from '../src/modules/preliminary-assessment/domain/model/instrument.js';

type CatalogQuestion = { question_id: string; display_order: number | null; definition: unknown };
type CatalogVersion = {
  instrument_id: string; instrument_version_id: string; version: string; status: string;
  approval_status: string; approved_at: Date | null; approval_reference: string | null;
  license_status: string; license_reference: string | null; effective_at: Date;
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Local DASS-21 publication is disabled when NODE_ENV=production');
  const args = parseArguments(process.argv.slice(2));
  const manifestFile = resolve(process.cwd(), args.manifest);
  const manifestRoot = await realpath(process.cwd());
  const realManifestFile = await realpath(manifestFile);
  assertWithinRoot(manifestRoot, realManifestFile, 'Manifest file must be inside the repository workspace');
  const manifest = dass21PublicationManifestSchema.parse(JSON.parse(await readFile(realManifestFile, 'utf8')));
  if (manifest.instrument.instrumentId !== DASS21_INSTRUMENT_ID) throw new Error('Manifest instrument identity is not the DASS-21 catalog identity');

  await verifyEvidenceDocuments(manifestRoot, manifest);
  const connectionString = validateAdminDatabaseUrl(process.env.DASS21_ADMIN_DATABASE_URL, manifest.targetDatabase);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000, application_name: 'dass21_local_publication' });
  try {
    const identity = await pool.query<{ database_name: string; server_address: string | null }>(
      'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
    );
    const target = identity.rows[0];
    if (target?.database_name !== manifest.targetDatabase || !target.server_address || !isAllowedLoopbackAddress(target.server_address)) {
      throw new Error('Connected database identity is not the explicit local manifest target');
    }
    if (args.publish && args.confirm !== `${manifest.targetDatabase}/${manifest.instrument.instrumentVersionId}`) {
      throw new Error('Publication requires --confirm <database>/<exact-instrumentVersionId>');
    }

    const client = await pool.connect();
    try {
      await validateAndOptionallyPublish(client, manifest, args.publish);
    } finally {
      client.release();
    }

    const runtimeAuthorization = toDass21RuntimeAuthorization(manifest);
    process.stdout.write(`${JSON.stringify({
      status: args.publish ? 'published_and_audited' : 'validated_no_write',
      database: manifest.targetDatabase,
      instrumentVersionId: manifest.instrument.instrumentVersionId,
      instrumentVersion: manifest.instrument.instrumentVersion,
      runtimeAuthorization,
      nextStep: 'Review and register this exact entry in productionDass21VersionAuthorizations in a separate code review; no source configuration was changed by this command.',
    }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

async function validateAndOptionallyPublish(client: PoolClient, manifest: Dass21PublicationManifest, publish: boolean): Promise<void> {
  const auditTable = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.dass21_version_publication_audit') AS table_name");
  if (!auditTable.rows[0]?.table_name) throw new Error('Publication audit migration is not applied; no publication was attempted');

  await client.query(publish ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const versionQuery = await client.query<CatalogVersion>(
      `SELECT instrument_id, instrument_version_id, version, status, approval_status, approved_at,
              approval_reference, license_status, license_reference, effective_at
         FROM assessment_instrument_versions
        WHERE instrument_version_id = $1 AND instrument_id = $2${publish ? ' FOR UPDATE' : ''}`,
      [manifest.instrument.instrumentVersionId, manifest.instrument.instrumentId],
    );
    const version = versionQuery.rows[0];
    if (!version || version.version !== manifest.instrument.instrumentVersion) throw new Error('Exact instrument version identity does not match the catalog');
    if (version.status !== 'draft' || version.approval_status !== 'pending' || version.approved_at !== null || version.approval_reference !== null) {
      throw new Error('Publication accepts only the exact pending draft; already published, rejected, or altered versions fail closed');
    }
    if (version.license_status !== 'not_reviewed' || version.license_reference !== null) throw new Error('Draft license state changed; review it before publication');

    const questionQuery = await client.query<CatalogQuestion>(
      `SELECT question_id, display_order, definition FROM assessment_instrument_questions
        WHERE instrument_version_id = $1 ORDER BY display_order ASC`,
      [version.instrument_version_id],
    );
    const snapshot = questionQuery.rows;
    if (snapshot.length !== 21 || snapshot.some((question, index) => question.display_order !== index + 1)) {
      throw new Error('Published DASS-21 version must contain exactly 21 ordered questions');
    }
    if (hashDass21QuestionSnapshot(toDass21QuestionSnapshot(snapshot)) !== manifest.instrument.questionSetSha256.toLowerCase()) {
      throw new Error('Question-set SHA-256 does not match the externally reviewed manifest');
    }
    const candidate = parseInstrumentVersion({
      instrumentId: version.instrument_id,
      instrumentVersionId: version.instrument_version_id,
      version: version.version,
      effectiveAt: manifest.effectiveAt,
      status: 'approved',
      questions: snapshot.map(question => ({
        ...(typeof question.definition === 'object' && question.definition !== null ? question.definition : {}),
        displayOrder: question.display_order,
      })),
      approval: { status: 'approved', approvedAt: manifest.administration.authorizedAt, approvalReference: manifest.administration.evidenceReference },
      license: { status: manifest.license.status, reference: manifest.license.reference },
    });
    if (!isInstrumentAvailable(candidate)) throw new Error('Instrument domain validation rejected publication');

    if (manifest.scoring) await requireFrozenMapping(client, manifest, snapshot);
    const existingAudit = await client.query('SELECT 1 FROM dass21_version_publication_audit WHERE instrument_version_id = $1', [version.instrument_version_id]);
    if (existingAudit.rowCount) throw new Error('A publication audit event already exists for this version');

    if (publish) {
      const updated = await client.query(
        `UPDATE assessment_instrument_versions
            SET status = 'approved', approval_status = 'approved', approved_at = $1, approval_reference = $2,
                license_status = $3, license_reference = $4, effective_at = $5, updated_at = now()
          WHERE instrument_version_id = $6 AND instrument_id = $7 AND status = 'draft' AND approval_status = 'pending'
          RETURNING instrument_version_id`,
        [manifest.administration.authorizedAt, manifest.administration.evidenceReference, manifest.license.status,
          manifest.license.reference, manifest.effectiveAt, version.instrument_version_id, version.instrument_id],
      );
      if (updated.rowCount !== 1) throw new Error('Catalog publication lost its locked pending-draft state');
      await client.query(
        `INSERT INTO dass21_version_publication_audit
          (event_id, instrument_id, instrument_version_id, instrument_version, question_set_sha256,
           operator_name, operator_role, decision_bundle, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())`,
        [randomUUID(), version.instrument_id, version.instrument_version_id, version.version,
          manifest.instrument.questionSetSha256.toLowerCase(), manifest.operator.name, manifest.operator.role,
          JSON.stringify(manifest)],
      );
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection cleanup remains in finally */ }
    throw error;
  }
}

async function requireFrozenMapping(client: PoolClient, manifest: Dass21PublicationManifest, questions: readonly CatalogQuestion[]): Promise<void> {
  const mapping = await client.query<{ mapping_id: string; status: string }>(
    `SELECT mapping_id, status FROM assessment_scoring_mapping_versions
      WHERE instrument_id = $1 AND instrument_version_id = $2 AND mapping_version = $3`,
    [manifest.instrument.instrumentId, manifest.instrument.instrumentVersionId, manifest.scoring!.mappingVersion],
  );
  const row = mapping.rows[0];
  if (!row || row.status !== 'frozen') throw new Error('Scoring authorization requires its exact frozen question mapping');
  const entries = await client.query<{ total: string; distinct_items: string; first_item: number | null; last_item: number | null; valid_questions: string }>(
    `SELECT count(*)::text AS total, count(DISTINCT item_number)::text AS distinct_items,
            min(item_number)::int AS first_item, max(item_number)::int AS last_item,
            count(*) FILTER (WHERE question_id = ANY($2::uuid[]))::text AS valid_questions
       FROM assessment_scoring_item_mappings WHERE mapping_id = $1`,
    [row.mapping_id, questions.map(question => question.question_id)],
  );
  const coverage = entries.rows[0];
  if (!coverage || coverage.total !== '21' || coverage.distinct_items !== '21' || coverage.first_item !== 1 ||
      coverage.last_item !== 21 || coverage.valid_questions !== '21') {
    throw new Error('Frozen scoring mapping does not cover the exact 21-question version');
  }
}

async function verifyEvidenceDocuments(root: string, manifest: Dass21PublicationManifest): Promise<void> {
  const decisions = [manifest.administration, manifest.license.evidence, manifest.scoring, manifest.interpretation, manifest.participantDisclosure]
    .filter((decision): decision is NonNullable<typeof decision> => decision !== null);
  for (const decision of decisions) {
    for (const document of decision.documents) {
      if (isAbsolute(document.file)) throw new Error('Evidence paths must be repository-relative');
      const resolved = await realpath(resolve(root, document.file));
      assertWithinRoot(root, resolved, 'Evidence file must remain inside the repository workspace');
      const actual = createHash('sha256').update(await readFile(resolved)).digest('hex');
      if (actual !== document.sha256.toLowerCase()) throw new Error(`Evidence hash mismatch for ${document.reference}`);
    }
  }
}

function validateAdminDatabaseUrl(value: string | undefined, targetDatabase: string): string {
  if (!value) throw new Error('DASS21_ADMIN_DATABASE_URL is required; DATABASE_URL is never used as a fallback');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DASS21_ADMIN_DATABASE_URL is malformed'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DASS21_ADMIN_DATABASE_URL must use PostgreSQL');
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== targetDatabase) throw new Error('Connection URL database does not match manifest targetDatabase');
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local publication only accepts loopback PostgreSQL hosts');
  return value;
}

function parseArguments(args: readonly string[]): { manifest: string; publish: boolean; confirm?: string } {
  let manifest: string | undefined;
  let confirm: string | undefined;
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--manifest') manifest = args[++index];
    else if (arg === '--publish') publish = true;
    else if (arg === '--confirm') confirm = args[++index];
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  if (!manifest) throw new Error('Usage: npm run dass21:publish:local -- --manifest <reviewed-manifest.json> [--publish --confirm <database>/<instrumentVersionId>]');
  if (!publish && confirm) throw new Error('--confirm is valid only with --publish');
  return { manifest, publish, confirm };
}

function assertWithinRoot(root: string, target: string, message: string): void {
  const path = relative(root, target);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(message);
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown publication failure';
  process.stderr.write(`DASS-21 publication stopped safely: ${message}\n`);
  process.exitCode = 1;
});
