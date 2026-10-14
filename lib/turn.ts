import { createLogger } from "@/lib/logger";

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const log = createLogger("lib/turn");

/**
 * Media only reaches the other side if the browsers can find a network path.
 * STUN alone fails on most home and mobile networks (symmetric NAT), so a TURN
 * relay is what makes calls work between different networks.
 *
 * Preferred: a hosted TURN service that mints short-lived credentials.
 * TURN_CREDENTIALS_URL is its credential endpoint: it takes a POST of { ttl }
 * with a bearer token (TURN_API_TOKEN) and answers { iceServers }. The token
 * stays on the server; browsers only ever see the short-lived credentials.
 * Static credentials would be a standing invitation to use your relay bandwidth.
 */
export async function getTurnServers(): Promise<IceServer[]> {
  const credentialsUrl = process.env.TURN_CREDENTIALS_URL;
  const apiToken = process.env.TURN_API_TOKEN;

  if (credentialsUrl && apiToken) {
    try {
      const response = await fetch(credentialsUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { iceServers?: IceServer | IceServer[] };
        if (data.iceServers) return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      }
      log.warn("turn credential service rejected the request", { status: response.status });
    } catch (error) {
      // Fall through to any statically configured relay below.
      log.warn("turn credential service unreachable — falling back to static relay config", { error });
    }
  }

  // Any TURN server (e.g. your own coturn), configured directly.
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_PASSWORD;
  if (url && username && credential) return [{ urls: url, username, credential }];

  return [];
}
