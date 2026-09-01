import { runScheduledSync } from "./run-scheduled-sync.mjs";
import { pathToFileURL } from "node:url";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const STARTUP_BOUNDARY_GUARD_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export function nextSyncBoundary(now = Date.now()) {
  return (Math.floor(now / THIRTY_MINUTES_MS) + 1) * THIRTY_MINUTES_MS;
}

function wait(delayMs, signal) {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runWithRetry(signal) {
  for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
    try {
      await runScheduledSync();
      process.stdout.write(`sync completed at ${new Date().toISOString()}\n`);
      return;
    } catch (error) {
      process.stderr.write(
        `sync attempt ${attempt} failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
      if (attempt < 3) await wait(RETRY_DELAY_MS, signal);
    }
  }
}

export async function runScheduler({ signal }) {
  const firstBoundary = nextSyncBoundary();
  if (firstBoundary - Date.now() > STARTUP_BOUNDARY_GUARD_MS) {
    await runWithRetry(signal);
  }

  while (!signal.aborted) {
    const nextRun = nextSyncBoundary();
    process.stdout.write(`next sync scheduled for ${new Date(nextRun).toISOString()}\n`);
    await wait(Math.max(0, nextRun - Date.now()), signal);
    if (!signal.aborted) await runWithRetry(signal);
  }
}

async function main() {
  const controller = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"]) {
    process.on(event, () => controller.abort());
  }
  await runScheduler({ signal: controller.signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
