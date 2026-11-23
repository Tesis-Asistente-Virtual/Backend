import { describe, expect, it } from 'vitest';
import {
  compareLongitudinalConversationSnapshots,
  longitudinalConversationComparisonSchema,
  longitudinalConversationSnapshotSchema,
  longitudinalConversationComparisonContractVersion,
  type LongitudinalConversationSnapshot,
} from '../../../src/modules/longitudinal-monitoring/domain/model/longitudinal-conversation-comparison.js';

const ids = {
  earlierSession: '550e8400-e29b-41d4-a716-446655440001',
  laterSession: '550e8400-e29b-41d4-a716-446655440002',
  earlierConversation: '550e8400-e29b-41d4-a716-446655440003',
  laterConversation: '550e8400-e29b-41d4-a716-446655440004',
  earlierMessage: '550e8400-e29b-41d4-a716-446655440005',
  laterMessage: '550e8400-e29b-41d4-a716-446655440006',
  comparisonMessage: '550e8400-e29b-41d4-a716-446655440007',
  foreignMessage: '550e8400-e29b-41d4-a716-446655440008',
  otherSession: '550e8400-e29b-41d4-a716-446655440009',
};

function snapshots(relation: 'change' | 'continuity' | null = 'change') {
  const earlier: LongitudinalConversationSnapshot = {
    contractVersion: longitudinalConversationComparisonContractVersion,
    sessionId: ids.earlierSession,
    conversationId: ids.earlierConversation,
    observedAt: '2026-01-10T10:00:00.000Z',
    selectedMessageIds: [ids.earlierMessage],
    reportedObservations: [{
      observationIndex: 0,
      evidenceStatus: 'reported',
      field: 'duration',
      text: 'Relato sintético: la situación ocurrió durante una semana ficticia.',
      sourceMessageIds: [ids.earlierMessage],
    }],
    temporalContext: null,
  };
  const later: LongitudinalConversationSnapshot = {
    contractVersion: longitudinalConversationComparisonContractVersion,
    sessionId: ids.laterSession,
    conversationId: ids.laterConversation,
    observedAt: '2026-02-10T10:00:00.000Z',
    selectedMessageIds: [ids.laterMessage, ids.comparisonMessage],
    reportedObservations: [{
      observationIndex: 1,
      evidenceStatus: 'reported',
      field: 'duration',
      text: 'Relato sintético de un segundo periodo ficticio.',
      sourceMessageIds: [ids.laterMessage],
    }],
    temporalContext: relation ? {
      explicitlyReported: true,
      relation,
      earlierSessionId: ids.earlierSession,
      earlierConversationId: ids.earlierConversation,
      laterSessionId: ids.laterSession,
      laterConversationId: ids.laterConversation,
      earlierObservationIndex: 0,
      laterObservationIndex: 1,
      comparisonMessageIds: [ids.comparisonMessage],
    } : null,
  };
  return { earlier, later };
}

describe('longitudinal conversation comparison', () => {
  it('reports an explicitly linked change with evidence from both periods', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, later);

    expect(result.comparisonStatus).toBe('explicit_change_reported');
    expect(result.descriptiveComparisons[0]?.evidence.earlier).toMatchObject({
      period: 'earlier',
      sessionId: ids.earlierSession,
      conversationId: ids.earlierConversation,
      messageIds: [ids.earlierMessage],
    });
    expect(result.descriptiveComparisons[0]?.evidence.later.period).toBe('later');
    expect(result.descriptiveComparisons[0]?.evidence.later.messageIds).toEqual([ids.laterMessage]);
    expect(result.descriptiveComparisons[0]?.evidence.temporalLink).toMatchObject({
      period: 'later', sessionId: ids.laterSession, conversationId: ids.laterConversation,
      observationIndex: 1, messageIds: [ids.comparisonMessage],
    });
    expect(JSON.stringify(result)).not.toContain('Relato sintético');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('diagnosis');
  });

  it('reports explicitly stated continuity without inferring it from matching text', () => {
    const { earlier, later } = snapshots('continuity');
    expect(compareLongitudinalConversationSnapshots(earlier, later).comparisonStatus).toBe('explicit_continuity_reported');
  });

  it('returns insufficient information when the snapshots do not carry an explicit temporal link', () => {
    const { earlier, later } = snapshots(null);
    const result = compareLongitudinalConversationSnapshots(earlier, later);
    expect(result.comparisonStatus).toBe('insufficient_information');
    expect(result.informationGaps).toEqual(['no_explicit_temporal_link']);
    expect(result.descriptiveComparisons).toEqual([]);
  });

  it('does not infer change when only one period has reported observations', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots({ ...earlier, reportedObservations: [] }, later);
    expect(result.informationGaps).toEqual(['only_one_period_has_reported_observations']);
  });

  it('returns insufficient information when both periods have no observations', () => {
    const { earlier, later } = snapshots(null);
    const result = compareLongitudinalConversationSnapshots(
      { ...earlier, reportedObservations: [] },
      { ...later, reportedObservations: [] },
    );
    expect(result.informationGaps).toEqual(['no_reported_observations']);
  });

  it('rejects observation messages that do not belong to the snapshot', () => {
    const { earlier } = snapshots();
    const parsed = longitudinalConversationSnapshotSchema.safeParse({
      ...earlier,
      reportedObservations: [{ ...earlier.reportedObservations[0], sourceMessageIds: [ids.foreignMessage] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('does not accept crossed session or observation references as evidence', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, {
      ...later,
      temporalContext: { ...later.temporalContext!, earlierSessionId: ids.otherSession },
    });
    expect(result.comparisonStatus).toBe('insufficient_information');
    expect(result.informationGaps).toEqual(['temporal_evidence_does_not_match_both_periods']);
  });

  it('requires distinct conversations and a verifiable temporal ordering', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, { ...later, observedAt: earlier.observedAt });
    expect(result.informationGaps).toEqual(['period_order_is_not_verifiable']);
    expect(compareLongitudinalConversationSnapshots(earlier, { ...later, conversationId: earlier.conversationId }).comparisonStatus)
      .toBe('insufficient_information');
  });

  it('rejects malformed, extra, or duplicated references', () => {
    const { earlier } = snapshots();
    expect(longitudinalConversationSnapshotSchema.safeParse({ ...earlier, accountId: ids.otherSession }).success).toBe(false);
    expect(longitudinalConversationSnapshotSchema.safeParse({ ...earlier, selectedMessageIds: [ids.earlierMessage, ids.earlierMessage] }).success).toBe(false);
    expect(longitudinalConversationSnapshotSchema.safeParse({
      ...earlier,
      reportedObservations: [earlier.reportedObservations[0], { ...earlier.reportedObservations[0]!, text: 'Otro relato ficticio.' }],
    }).success).toBe(false);
    expect(longitudinalConversationSnapshotSchema.safeParse({
      ...earlier,
      reportedObservations: [{ ...earlier.reportedObservations[0], field: 'diagnosis' }],
    }).success).toBe(false);
    expect(longitudinalConversationSnapshotSchema.safeParse({
      ...earlier,
      reportedObservations: [{ ...earlier.reportedObservations[0], evidenceStatus: 'ambiguous' }],
    }).success).toBe(false);
    const { later } = snapshots('change');
    expect(longitudinalConversationSnapshotSchema.safeParse({
      ...later,
      temporalContext: { ...later.temporalContext!, explicitlyReported: false },
    }).success).toBe(false);
  });

  it('rejects temporal assertions that cross conversations or periods', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, {
      ...later,
      temporalContext: { ...later.temporalContext!, earlierConversationId: ids.laterConversation },
    });
    expect(result.comparisonStatus).toBe('insufficient_information');
    expect(result.informationGaps).toEqual(['temporal_evidence_does_not_match_both_periods']);
  });

  it('rejects structurally incompatible observations rather than calling them a change', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, {
      ...later,
      reportedObservations: [{ ...later.reportedObservations[0]!, field: 'frequency' }],
    });
    expect(result.comparisonStatus).toBe('insufficient_information');
  });

  it('does not accept unsupported relation types', () => {
    const { later } = snapshots('change');
    expect(longitudinalConversationSnapshotSchema.safeParse({
      ...later,
      temporalContext: { ...later.temporalContext!, relation: 'improvement' },
    }).success).toBe(false);
  });

  it('does not allow selected message references to be reused across periods', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots(earlier, {
      ...later,
      selectedMessageIds: [...later.selectedMessageIds, ids.earlierMessage],
    });
    expect(result.informationGaps).toEqual(['message_references_overlap_between_periods']);
  });

  it('does not treat an earlier-period assertion as evidence for this pair', () => {
    const { earlier, later } = snapshots('change');
    const result = compareLongitudinalConversationSnapshots({
      ...earlier,
      temporalContext: { ...later.temporalContext!, comparisonMessageIds: [ids.earlierMessage] },
    }, later);
    expect(result.comparisonStatus).toBe('insufficient_information');
    expect(result.informationGaps).toEqual(['temporal_evidence_does_not_match_both_periods']);
  });

  it('is deterministic for identical snapshots and keeps output strict', () => {
    const { earlier, later } = snapshots();
    const first = compareLongitudinalConversationSnapshots(earlier, later);
    const second = compareLongitudinalConversationSnapshots(earlier, later);
    expect(first).toEqual(second);
    expect(longitudinalConversationComparisonSchema.safeParse({ ...first, severity: 'high' }).success).toBe(false);
  });
});
