import { describe, expect, it } from 'vitest';
import {
  parseOptionalFeatureFlag,
  parseOptionalPositiveInteger,
  resolveConversationalSignalAnalysisPilotPolicy,
} from '../../src/config/conversational-signal-analysis-policy.js';

const approvedPilot = {
  enabled: true,
  deployment: 'authorized_pilot',
  allowedAccountIds: 'a11d7c60-d25c-4bec-aeb5-6bdac8910ac3,2d1f07b8-2194-4cf8-99cf-3274c3ea62f5',
  retentionDays: 90,
  authorizationReference: 'institutional-record-2026-001',
} as const;

describe('conversational signal pilot policy configuration', () => {
  it('remains disabled by default without exposing an allowlist', () => {
    expect(resolveConversationalSignalAnalysisPilotPolicy({
      enabled: false, deployment: undefined, allowedAccountIds: undefined,
      retentionDays: undefined, authorizationReference: undefined,
    })).toEqual({ enabled: false, retentionDays: null, allowedAccountIds: [] });
  });

  it('enables only with an authorized-pilot deployment, documented reference, retention, and UUID allowlist', () => {
    expect(resolveConversationalSignalAnalysisPilotPolicy(approvedPilot)).toEqual({
      enabled: true, retentionDays: 90,
      allowedAccountIds: ['a11d7c60-d25c-4bec-aeb5-6bdac8910ac3', '2d1f07b8-2194-4cf8-99cf-3274c3ea62f5'],
    });
  });

  it('rejects partial, non-authorized, duplicate, malformed, or excessive pilot configuration', () => {
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, deployment: 'development' })).toThrow(/authorized_pilot/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, authorizationReference: undefined })).toThrow(/authorization reference/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, retentionDays: 0 })).toThrow(/90-day/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, retentionDays: 30 })).toThrow(/90-day/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, retentionDays: 366 })).toThrow(/90-day/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, allowedAccountIds: '' })).toThrow(/allowlist/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, allowedAccountIds: 'not-a-uuid' })).toThrow(/allowlist/);
    expect(() => resolveConversationalSignalAnalysisPilotPolicy({ ...approvedPilot, allowedAccountIds: 'a11d7c60-d25c-4bec-aeb5-6bdac8910ac3,A11D7C60-D25C-4BEC-AEB5-6BDAC8910AC3' })).toThrow(/allowlist/);
  });

  it('accepts only explicit boolean flags and positive integer retention values', () => {
    expect(parseOptionalFeatureFlag('FEATURE', undefined)).toBe(false);
    expect(parseOptionalFeatureFlag('FEATURE', 'false')).toBe(false);
    expect(parseOptionalFeatureFlag('FEATURE', 'true')).toBe(true);
    expect(() => parseOptionalFeatureFlag('FEATURE', 'yes')).toThrow(/exactly true or false/);
    expect(parseOptionalPositiveInteger('RETENTION', undefined)).toBeUndefined();
    expect(parseOptionalPositiveInteger('RETENTION', '30')).toBe(30);
    expect(() => parseOptionalPositiveInteger('RETENTION', '0')).toThrow(/positive integer/);
    expect(() => parseOptionalPositiveInteger('RETENTION', '30days')).toThrow(/positive integer/);
  });
});
