import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  SignalAuthorizationUnavailable,
  SignalConsentRequired,
  SignalConversationNotFound,
  SignalExtractionUnavailable,
  SignalMessageReferencesInvalid,
} from '../../../src/modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';
import { ConversationSignalExtractionController, type ConversationSignalExtractionService } from '../../../src/modules/conversational-processing/interfaces/rest/conversation-signal-extraction-controller.js';
import { errorHandler } from '../../../src/shared/infrastructure/http/error-handler.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const messageId = '550e8400-e29b-41d4-a716-446655440010';
const extraction = {
  schemaVersion: '1.0' as const,
  observations: [],
  missingInformation: [{ field: 'manifestation' as const, reason: 'not_assessed' as const }],
  clarificationQuestions: [],
};

function harness(service: ConversationSignalExtractionService | null, auth: { accountId: string } | null = { accountId }) {
  const req = Object.assign(new EventEmitter(), {
    auth: auth ?? undefined,
    params: { id: conversationId },
    body: { messageIds: [messageId] },
    aborted: false,
  }) as unknown as Request;
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 200,
    destroyed: false,
    writableEnded: false,
    status: vi.fn(function (this: { statusCode: number }, code: number) { this.statusCode = code; return this; }),
    json: vi.fn(function (this: { writableEnded: boolean }, _body: unknown) { this.writableEnded = true; return this; }),
  }) as unknown as Response;
  const controller = new ConversationSignalExtractionController(service);
  return { req, res, controller };
}

function mapError(error: unknown) {
  const req = {} as Request;
  const res = {
    headersSent: false,
    statusCode: 200,
    status: vi.fn(function (this: { statusCode: number }, code: number) { this.statusCode = code; return this; }),
    json: vi.fn(function (this: { body: unknown }, body: unknown) { this.body = body; return this; }),
  } as unknown as Response & { statusCode: number; body: unknown };
  const next = vi.fn() as NextFunction;
  errorHandler(error, req, res, next);
  return res;
}

describe('conversation signal extraction HTTP controller', () => {
  it('requires the authenticated identity, rejects extra fields, and returns the versioned DTO without persistence', async () => {
    const execute = vi.fn(async () => extraction);
    const service: ConversationSignalExtractionService = { execute };
    const h = harness(service);

    await h.controller.execute(h.req, h.res);
    expect(h.res.status).toHaveBeenCalledWith(200);
    expect(h.res.json).toHaveBeenCalledWith({ status: 'completed', ...extraction });
    expect(execute).toHaveBeenCalledWith(accountId, { conversationId, messageIds: [messageId] }, expect.any(AbortSignal));

    const noAuth = harness(service, null);
    await noAuth.controller.execute(noAuth.req, noAuth.res);
    expect(noAuth.res.status).toHaveBeenCalledWith(401);
    expect(execute).toHaveBeenCalledTimes(1);

    const invalid = harness(service);
    (invalid.req as unknown as { body: unknown }).body = { messageIds: [messageId], accountId };
    await expect(invalid.controller.execute(invalid.req, invalid.res)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('propagates client disconnect cancellation and does not write a response after disconnect', async () => {
    const execute = vi.fn((_accountId: string, _input: unknown, signal?: AbortSignal) => new Promise<typeof extraction>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const h = harness({ execute });
    const pending = h.controller.execute(h.req, h.res);
    h.res.emit('close');
    await expect(pending).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.res.json).not.toHaveBeenCalled();
  });

  it('returns an ephemeral descriptive result without exposing the owner account ID', async () => {
    const execute = vi.fn(async () => extraction);
    const h = harness({ execute });
    await h.controller.generateResult(h.req, h.res);
    expect(h.res.status).toHaveBeenCalledWith(200);
    const body = h.res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'completed',
      conversationId,
      schemaVersion: '1.0',
      extractorVersion: '1.0.0',
      sourceMessageIds: [messageId],
      summary: {
        descriptiveStatus: 'no_observations',
        emptyObservationsMeaning: 'not_evidence_of_absence',
      },
    });
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('generatedAt');
    expect(body).not.toHaveProperty('accountId');
  });

  it.each([
    [new SignalConsentRequired(), 403, 'Current consent is required for conversation signal extraction'],
    [new SignalConversationNotFound(), 404, 'Conversation not found'],
    [new SignalMessageReferencesInvalid(), 400, 'Conversation message references are invalid'],
    [new SignalAuthorizationUnavailable(), 503, 'Consent status is temporarily unavailable'],
    [new SignalExtractionUnavailable(), 503, 'Conversation signal extraction is temporarily unavailable'],
  ] as const)('maps $0 to HTTP $1 without exposing internal details', (failure, status, expectedPublicMessage) => {
    const response = mapError(failure);
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith({ error: expectedPublicMessage });
    expect(response.json).not.toHaveProperty('stack');
  });
});
