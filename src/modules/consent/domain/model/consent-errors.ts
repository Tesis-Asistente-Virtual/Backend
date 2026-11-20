export class ConsentIdempotencyConflict extends Error {
  constructor() { super('Consent idempotency key conflict'); this.name = 'ConsentIdempotencyConflict'; }
}
