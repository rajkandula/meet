import { createHmac, timingSafeEqual } from "node:crypto";

export type RealtimeClaims = {
  roomId: string;
  userId: string;
  name: string;
  exp: number;
};

/**
 * The shared secret the app signs room tokens with and the signaling servers
 * verify them with. The fallback must match realtime/server.mjs exactly —
 * they used to disagree ("development-realtime-secret" here), which made every
 * local token verification fail whenever REALTIME_SECRET was unset.
 *
 * In production the fallback is refused: it is a committed literal, so honoring
 * it would make room tokens forgeable and turn the x-realtime-secret header on
 * /api/meetings/end into an auth bypass. Failing closed surfaces the missing
 * REALTIME_SECRET instead.
 */
export function realtimeSecret() {
  const secret = process.env.REALTIME_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_SECRET must be set in production (the same value on the app and the signaling server).");
  }
  return "local-development-realtime-secret";
}

function sign(payload: string) {
  return createHmac("sha256", realtimeSecret()).update(payload).digest("base64url");
}

export function createRealtimeToken(claims: RealtimeClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a room token minted by createRealtimeToken. Used by the SFU proxy
 * route to check that a caller actually belongs to a room (guests included)
 * before spending SFU resources on their behalf. Any malformed input reads as
 * "invalid token", never as a crash.
 */
export function verifyRealtimeToken(token: string): RealtimeClaims | null {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    const signatureBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) return null;

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as RealtimeClaims;
    if (!claims.roomId || !claims.userId || !claims.name || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
