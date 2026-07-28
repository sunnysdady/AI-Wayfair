export type DropshipOrderPageRequest = {
  fromDate: string;
  limit: number;
  sortOrder: "ASC";
};

export function utcDatePart(value: Date | string): string;

export function fetchAllDropshipOrders<T extends { poNumber?: string; poDate?: string }>(
  options: {
    fromDate: string;
    fetchPage: (request: DropshipOrderPageRequest) => Promise<T[]>;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<{
  orders: T[];
  pages: number;
  complete: true;
  highWatermark: string;
}>;
