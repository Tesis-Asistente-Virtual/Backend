import type { InstrumentId, InstrumentVersion, InstrumentVersionId } from '../model/instrument.js';

export type NewInstrumentDraft = Omit<InstrumentVersion, 'status'> & { readonly status: 'draft' };
export type InstrumentPublication = {
  readonly approval: InstrumentVersion['approval'];
  readonly license: InstrumentVersion['license'];
  readonly effectiveAt: Date;
};

/** Returns approved, license-cleared versions only; draft or retired instruments are never usable. */
export interface InstrumentCatalog {
  createDraft(instrument: NewInstrumentDraft): Promise<void>;
  updateDraft(instrument: NewInstrumentDraft): Promise<boolean>;
  publishVersion(versionId: InstrumentVersionId, publication: InstrumentPublication): Promise<InstrumentVersion | null>;
  findVersion(instrumentId: InstrumentId, versionId: InstrumentVersionId): Promise<InstrumentVersion | null>;
  findAvailableByVersionId(versionId: InstrumentVersionId, at: Date): Promise<InstrumentVersion | null>;
  listAvailable(limit: number, offset: number, at: Date): Promise<readonly InstrumentVersion[]>;
}
