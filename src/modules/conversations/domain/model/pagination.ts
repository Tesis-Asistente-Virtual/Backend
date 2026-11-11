export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}
