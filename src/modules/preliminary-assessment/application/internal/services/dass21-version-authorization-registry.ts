import { z } from 'zod';
import type { Dass21InterpretationSupportProvider } from '../../ports/dass21-interpretation-support-provider.js';
import { DASS21_INTERPRETATION_BASIS, DASS21_INTERPRETATION_VERSION } from '../../../domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../domain/model/dass21-scoring.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy, type InstrumentVersion } from '../../../domain/model/instrument.js';
import type { ApprovedDass21InterpretationSupport } from '../../../domain/model/dass21-internal-result.js';

const authorizationEvidenceSchema = z.object({
  evidenceReference: z.string().trim().min(1).max(500),
  scope: z.string().trim().min(1).max(300),
  responsible: z.string().trim().min(1).max(200),
  authorizedAt: z.date(),
}).strict();

export const dass21VersionAuthorizationSchema = z.object({
  instrumentCode: z.literal('DASS-21'),
  instrumentId: z.string().uuid(),
  instrumentVersionId: z.string().uuid(),
  instrumentVersion: z.string().trim().min(1).max(40),
  administration: authorizationEvidenceSchema,
  scoring: authorizationEvidenceSchema.extend({
    mappingVersion: z.string().trim().min(1).max(40), scoringVersion: z.literal(DASS21_SCORING_VERSION),
  }).strict().nullable(),
  interpretation: authorizationEvidenceSchema.extend({
    scoringVersion: z.literal(DASS21_SCORING_VERSION), interpretationVersion: z.literal(DASS21_INTERPRETATION_VERSION),
  }).strict().nullable(),
  participantDisclosure: authorizationEvidenceSchema.extend({
    resultContractVersion: z.literal('dass21-participant-result-1.0'),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (value.interpretation && !value.scoring) {
    context.addIssue({ code: 'custom', path: ['interpretation'], message: 'Interpretation authorization requires its exact scoring authorization' });
  }
  if (value.participantDisclosure && (!value.interpretation || !value.scoring)) {
    context.addIssue({ code: 'custom', path: ['participantDisclosure'], message: 'Participant disclosure requires separate scoring and interpretation authorization' });
  }
});

export type Dass21VersionAuthorization = z.infer<typeof dass21VersionAuthorizationSchema>;
export type Dass21ScoringAuthorization = Dass21VersionAuthorization & {
  scoring: NonNullable<Dass21VersionAuthorization['scoring']>;
};

/** Stable identity used by the existing Spanish candidate; future DASS versions retain this instrument identity. */
export const DASS21_INSTRUMENT_ID = '00000000-0000-4000-8000-000000008a91';

/**
 * Server-owned, exact-version authorization source. Production starts empty.
 * Entries may only be added after the referenced decisions are recorded outside
 * the application and reviewed; no HTTP input or environment flag can populate it.
 */
export class Dass21VersionAuthorizationRegistry implements Dass21InterpretationSupportProvider {
  private readonly byVersionId: ReadonlyMap<string, Dass21VersionAuthorization>;
  private readonly knownInstrumentIds: ReadonlySet<string>;

  constructor(entries: readonly unknown[] = [], knownInstrumentIds: readonly string[] = []) {
    const parsedEntries = entries.map(entry => dass21VersionAuthorizationSchema.parse(entry));
    const byVersionId = new Map<string, Dass21VersionAuthorization>();
    const knownIds = new Set(knownInstrumentIds.map(id => z.string().uuid().parse(id)));
    for (const entry of parsedEntries) {
      if (byVersionId.has(entry.instrumentVersionId)) throw new Error('Duplicate DASS-21 authorization version');
      byVersionId.set(entry.instrumentVersionId, Object.freeze(entry));
      knownIds.add(entry.instrumentId);
    }
    this.byVersionId = byVersionId;
    this.knownInstrumentIds = knownIds;
  }

  availability(base: InstrumentAvailabilityPolicy = isInstrumentAvailable): InstrumentAvailabilityPolicy {
    return (instrument, at) => {
      if (!base(instrument, at)) return false;
      if (!this.knownInstrumentIds.has(instrument.instrumentId)) return true;
      const authorization = this.byVersionId.get(instrument.instrumentVersionId);
      return !!authorization && authorization.instrumentId === instrument.instrumentId &&
        authorization.instrumentVersion === instrument.version && evidenceIsCurrent(authorization.administration, at);
    };
  }

  getScoringAuthorization(instrumentVersionId: string, at: Date): Dass21ScoringAuthorization | null {
    const authorization = this.byVersionId.get(instrumentVersionId);
    if (!authorization || !authorization.scoring || !evidenceIsCurrent(authorization.administration, at) ||
        !evidenceIsCurrent(authorization.scoring, at)) return null;
    return authorization as Dass21ScoringAuthorization;
  }

  isParticipantDisclosureAuthorized(instrumentVersionId: string, at: Date): boolean {
    const authorization = this.byVersionId.get(instrumentVersionId);
    return !!authorization && !!authorization.scoring && !!authorization.interpretation && !!authorization.participantDisclosure &&
      evidenceIsCurrent(authorization.administration, at) && evidenceIsCurrent(authorization.scoring, at) &&
      evidenceIsCurrent(authorization.interpretation, at) && evidenceIsCurrent(authorization.participantDisclosure, at);
  }

  getApprovedSupport(instrumentVersionId: string): ApprovedDass21InterpretationSupport | null {
    const authorization = this.byVersionId.get(instrumentVersionId);
    if (!authorization?.scoring || !authorization.interpretation) return null;
    return {
      status: 'approved',
      approvalReference: authorization.interpretation.evidenceReference,
      approvedAt: authorization.interpretation.authorizedAt,
      support: {
        instrumentVersionId,
        scoringVersion: DASS21_SCORING_VERSION,
        interpretationVersion: DASS21_INTERPRETATION_VERSION,
        basis: DASS21_INTERPRETATION_BASIS,
      },
    };
  }

  getVersion(instrumentVersionId: string): Dass21VersionAuthorization | null {
    return this.byVersionId.get(instrumentVersionId) ?? null;
  }
}

function evidenceIsCurrent(evidence: z.infer<typeof authorizationEvidenceSchema>, at: Date): boolean {
  return !Number.isNaN(evidence.authorizedAt.getTime()) && evidence.authorizedAt <= at;
}

/** No human authorization has been recorded for the thesis candidate, so normal runtime starts fail-closed. */
export const productionDass21VersionAuthorizations: readonly unknown[] = Object.freeze([]);
export const productionDass21AuthorizationRegistry = new Dass21VersionAuthorizationRegistry(
  productionDass21VersionAuthorizations,
  [DASS21_INSTRUMENT_ID],
);
