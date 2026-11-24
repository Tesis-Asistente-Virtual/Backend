import { describe, expect, it } from 'vitest';
import { DASS21_INSTRUMENT_ID, Dass21VersionAuthorizationRegistry, dass21VersionAuthorizationSchema, productionDass21AuthorizationRegistry } from '../../../src/modules/preliminary-assessment/application/internal/services/dass21-version-authorization-registry.js';
import { DASS21_INTERPRETATION_BASIS, DASS21_INTERPRETATION_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';
import type { InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';

const instrumentId = '10000000-0000-4000-8000-000000000001';
const instrumentVersionId = '10000000-0000-4000-8000-000000000002';
const now = new Date('2026-01-01T00:00:00.000Z');
const evidence = { evidenceReference: 'TEST FIXTURE ONLY', scope: 'synthetic test', responsible: 'test fixture', authorizedAt: new Date('2025-12-01T00:00:00.000Z') };

function authorization(disclosure: boolean) {
  return {
    instrumentCode: 'DASS-21', instrumentId, instrumentVersionId, instrumentVersion: 'synthetic-approved-v1',
    administration: evidence,
    scoring: { ...evidence, mappingVersion: 'synthetic-map-1', scoringVersion: DASS21_SCORING_VERSION },
    interpretation: { ...evidence, scoringVersion: DASS21_SCORING_VERSION, interpretationVersion: DASS21_INTERPRETATION_VERSION },
    participantDisclosure: disclosure ? { ...evidence, resultContractVersion: 'dass21-participant-result-1.0' } : null,
  };
}

function approvedInstrument(): InstrumentVersion {
  return {
    instrumentId, instrumentVersionId, version: 'synthetic-approved-v1', effectiveAt: new Date('2025-12-01T00:00:00.000Z'),
    status: 'approved', approval: { status: 'approved', approvedAt: new Date('2025-12-01T00:00:00.000Z'), approvalReference: 'TEST FIXTURE ONLY' },
    license: { status: 'not_applicable', reference: 'TEST FIXTURE ONLY' },
    questions: Array.from({ length: 21 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${(index + 10).toString().padStart(12, '0')}`,
      prompt: `Synthetic item ${index + 1}`, responseType: 'number' as const, required: true, minimum: 0, maximum: 3, displayOrder: index + 1,
    })),
  };
}

describe('DASS-21 server authorization registry', () => {
  it('requires an exact server authorization entry to administer a known DASS instrument', () => {
    const denied = new Dass21VersionAuthorizationRegistry([], [instrumentId]);
    expect(denied.availability()(approvedInstrument(), now)).toBe(false);

    const allowed = new Dass21VersionAuthorizationRegistry([authorization(false)], [instrumentId]);
    expect(allowed.availability()(approvedInstrument(), now)).toBe(true);
    expect(allowed.availability()({ ...approvedInstrument(), version: 'different-version' }, now)).toBe(false);
  });

  it('does not expose a DASS version from the normal registry merely because a database row is approved', () => {
    const unregisteredApprovedVersion = { ...approvedInstrument(), instrumentId: DASS21_INSTRUMENT_ID };
    expect(productionDass21AuthorizationRegistry.availability()(unregisteredApprovedVersion, now)).toBe(false);
  });

  it('keeps scoring and participant disclosure as separate server decisions', () => {
    const registry = new Dass21VersionAuthorizationRegistry([authorization(false)], [instrumentId]);
    expect(registry.getScoringAuthorization(instrumentVersionId, now)?.scoring.mappingVersion).toBe('synthetic-map-1');
    expect(registry.isParticipantDisclosureAuthorized(instrumentVersionId, now)).toBe(false);

    const withDisclosure = new Dass21VersionAuthorizationRegistry([authorization(true)], [instrumentId]);
    expect(withDisclosure.isParticipantDisclosureAuthorized(instrumentVersionId, now)).toBe(true);

    const administrationOnly = new Dass21VersionAuthorizationRegistry([{
      ...authorization(false), scoring: null, interpretation: null,
    }], [instrumentId]);
    expect(administrationOnly.availability()(approvedInstrument(), now)).toBe(true);
    expect(administrationOnly.getScoringAuthorization(instrumentVersionId, now)).toBeNull();
    expect(administrationOnly.isParticipantDisclosureAuthorized(instrumentVersionId, now)).toBe(false);
  });

  it('rejects incomplete, duplicate, or future-dated authorization evidence', () => {
    expect(() => dass21VersionAuthorizationSchema.parse({ ...authorization(false), participantDisclosure: evidence, interpretation: null })).toThrow();
    expect(() => new Dass21VersionAuthorizationRegistry([authorization(false), authorization(false)], [instrumentId])).toThrow();
    const futureDated = new Dass21VersionAuthorizationRegistry([{
      ...authorization(true), administration: { ...evidence, authorizedAt: new Date('2027-01-01T00:00:00.000Z') },
    }], [instrumentId]);
    expect(futureDated.availability()(approvedInstrument(), now)).toBe(false);
    expect(futureDated.getApprovedSupport(instrumentVersionId)).toMatchObject({ status: 'approved', support: {
      scoringVersion: DASS21_SCORING_VERSION, interpretationVersion: DASS21_INTERPRETATION_VERSION, basis: DASS21_INTERPRETATION_BASIS,
    } });
  });
});
