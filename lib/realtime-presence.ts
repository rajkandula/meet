import { createLogger } from "@/lib/logger";
import { realtimeSecret } from "@/lib/realtime-token";

const PRESENCE_TIMEOUT_MS = 1200;

const log = createLogger("lib/realtime-presence");

// The dashboard polls presence every few seconds, so a down signaling server
// would flood the logs — warn on the first failure, then stay quiet until it
// recovers.
let warnedUnreachable = false;

function presenceUrl() {
  const base = process.env.REALTIME_WS_URL || "ws://localhost:3005";
  return `${base.replace(/^ws/, "http").replace(/\/$/, "")}/rooms`;
}

/** Room id -> participant count. Returns an empty map when signaling is unreachable. */
export async function getLiveRooms(): Promise<Record<string, number>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRESENCE_TIMEOUT_MS);
  try {
    // The live-room list reveals invite links, so the signaling server only
    // answers callers holding the shared secret.
    const response = await fetch(presenceUrl(), {
      headers: { "x-realtime-secret": realtimeSecret() },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      if (!warnedUnreachable) {
        warnedUnreachable = true;
        log.warn("presence endpoint returned an error — live badges will be empty", { status: response.status });
      }
      return {};
    }
    const data = (await response.json()) as { rooms?: Record<string, number> };
    warnedUnreachable = false;
    return data.rooms || {};
  } catch (error) {
    if (!warnedUnreachable) {
      warnedUnreachable = true;
      log.warn("signaling server unreachable — live badges will be empty", { error });
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
}
