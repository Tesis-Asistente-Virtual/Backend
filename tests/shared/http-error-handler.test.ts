import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';

describe('HTTP error handler contract', () => {
  it('maps the Express JSON parser malformed-body error to a safe 400', () => {
    const response = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(
      { type: 'entity.parse.failed', status: 400, body: '{"unexpected":' },
      {} as Request,
      response,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Invalid JSON body' });
    expect(next).not.toHaveBeenCalled();
  });
});
