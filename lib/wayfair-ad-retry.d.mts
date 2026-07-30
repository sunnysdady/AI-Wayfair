export function isRetryableAdvertisingStatus(status: number): boolean;

export function fetchAdvertisingResponse(
  input: string | URL | Request,
  init?: RequestInit,
  options?: {
    fetchImpl?: typeof fetch;
    wait?: (milliseconds: number) => Promise<void>;
    attempts?: number;
  },
): Promise<Response>;
