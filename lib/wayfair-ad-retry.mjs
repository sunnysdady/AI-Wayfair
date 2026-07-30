const DEFAULT_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;

export function isRetryableAdvertisingStatus(status) {
  return status === 401
    || status === 429
    || (status >= 500 && status <= 599);
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  if (
    retryAfter !== null
    && retryAfter.trim() !== ""
    && Number.isFinite(retryAfterSeconds)
    && retryAfterSeconds >= 0
  ) {
    return Math.min(retryAfterSeconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  return 500 * (attempt + 1);
}

export async function fetchAdvertisingResponse(
  input,
  init,
  {
    fetchImpl = fetch,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    attempts = DEFAULT_ATTEMPTS,
  } = {},
) {
  let response;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetchImpl(input, init);
    if (
      response.ok
      || !isRetryableAdvertisingStatus(response.status)
      || attempt === attempts - 1
    ) {
      return response;
    }
    try {
      await response.body?.cancel();
    } catch {
      // A failed error-body cancellation does not make the next read unsafe.
    }
    await wait(retryDelay(response, attempt));
  }
  return response;
}
