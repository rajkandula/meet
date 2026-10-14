# Decisions

This file has one short entry per decision that can be seen in the code or the
README. This repository's history starts with the open-source release commit
on 2026-10-13. Choices made before that are dated to the release, because their
earlier history is not in this repository.

Where a code comment or the README gives a reason, the entry quotes or follows
it. Otherwise the "why" describes the trade-off visible in the code. No earlier
history is invented.

## 2026-10-13: Next.js 14 and MongoDB, with the plain driver

- **Decided:** One Next.js 14 App Router app (TypeScript, React 18) serves the
  pages and the JSON API. MongoDB is used through the official `mongodb`
  driver, with document shapes declared as TypeScript types in `types/` and
  `lib/auth.ts`.
- **Options:** A separate frontend and backend. An ORM or schema layer.
  A SQL database.
- **Why:** One process for pages and API keeps deploys simple. The documents
  are small and mostly owner-scoped, so typed shapes in one place
  (`types/db.ts` says it exists "instead of re-typed ad hoc at every call
  site") were enough without an ORM.

## 2026-10-13: A self-owned WebSocket signaling server, deployed on its own

- **Decided:** WebRTC signaling, chat relay and room presence run in
  `realtime/server.mjs`, a small Node `ws` server with its own `package.json`.
- **Options:** Signaling inside the Next.js process. A hosted realtime or
  pub-sub service.
- **Why:** Next.js route handlers do not hold long-lived WebSockets. A
  separate process with one dependency can be deployed anywhere. The README
  calls it "a small self-owned WebSocket signaling server". The cost is that
  rooms live in memory, so only one instance can run.

## 2026-10-13: Mesh peer-to-peer by default, an SFU when configured

- **Decided:** Without SFU settings, rooms use a mesh in which the newcomer
  offers to everyone already there. When `REALTIME_SFU_API_URL`,
  `REALTIME_SFU_APP_ID` and `REALTIME_SFU_APP_SECRET` are all set, every
  participant opens one connection to a hosted SFU. Video goes up with three
  simulcast layers.
- **Options:** Mesh only. SFU only. Running a self-hosted media server.
- **Why:** A mesh needs no media infrastructure and suits one-to-one calls,
  but every person uploads a copy to every other person. The code comments
  say mesh calls "fall apart around four people". An SFU fixes that, and
  simulcast lets thumbnails take the cheap layer.

## 2026-10-13: The SFU is reached only through `/api/sfu`, with stateless ownership proof

- **Decided:** Browsers never see the SFU app secret. They call `POST /api/sfu`
  with their room token. Calls that change a session must also present an
  HMAC owner token over session, room and user, minted when the session is
  created.
- **Options:** Give browsers SFU credentials. Store session ownership in the
  database.
- **Why:** The session id is broadcast to the room so others can pull, so it
  cannot prove ownership. An HMAC needs no store, so it survives restarts and
  works across app instances (`lib/sfu.ts`).

## 2026-10-13: Username and password accounts with server-side sessions

- **Decided:** Accounts are a username plus a bcrypt hash (cost 12). Sessions
  are random tokens in a `sessions` collection with a 30-day TTL index, held in
  an HTTP-only `SameSite=Lax` cookie. "Keep me signed in" switches between a
  30-day cookie and a browser-session cookie.
- **Options:** Email accounts with verification. Third-party sign-in. Signed
  stateless JWT cookies.
- **Why:** This needs no email provider or identity provider to self-host.
  Server-side sessions can be revoked on logout. Password reset is therefore
  not built yet, and the login page says so.

## 2026-10-13: Guests join rooms by link without an account

- **Decided:** `/room/[meetingId]` is left out of the middleware matcher, and
  `POST /api/realtime/token` deliberately does not require a user. Guests join
  as "Guest User" and write nothing to the database.
- **Options:** Require sign-in for every room. A guest name prompt with
  stored guest records.
- **Why:** The comment in `middleware.ts` says invite links promise that
  anyone with the link can join. Bouncing invitees to the login page would
  break that promise.

## 2026-10-13: Signed room tokens and one shared secret between the two processes

- **Decided:** The app signs short-lived (6-hour) room tokens with
  HMAC-SHA256 under `REALTIME_SECRET`, and the signaling server verifies them.
  The same secret authenticates `GET /rooms` and the auto-end call to
  `POST /api/meetings/end`.
- **Options:** Let the signaling server read sessions from MongoDB. Unsigned
  room ids.
- **Why:** The signaling server stays database-free and still trusts only
  tokens the app issued. The app refuses the built-in development secret in
  production, so a missing secret fails loudly instead of making tokens
  forgeable (`lib/realtime-token.ts`).

## 2026-10-13: Any S3-compatible bucket, with browser-direct presigned uploads

- **Decided:** Recordings and avatars upload from the browser with a 15-minute
  presigned `PUT` (`lib/storage.ts`, `POST /api/uploads/sign`). The app stores
  only metadata.
- **Options:** Upload through the app server. Store files in MongoDB.
- **Why:** Large media never passes through the app server, as both the
  README and `lib/storage.ts` say. An S3-compatible API works with many
  providers and with self-hosted object stores.

## 2026-10-13: Recording happens in the recorder's browser

- **Decided:** The room page composites the visible tiles onto a 1280×720
  canvas, mixes all audio, and records WebM with `MediaRecorder`. The README
  states that server-side recording is not offered.
- **Options:** A server-side recording bot or media pipeline.
- **Why:** No extra server or media infrastructure is needed. It also works in
  encrypted rooms, because the recorder's browser already has decrypted
  tiles.

## 2026-10-13: Link-key end-to-end encryption

- **Decided:** An encrypted room carries its key in the URL fragment
  (`#k=...`). In SFU mode every frame is AES-GCM encrypted in the browser
  under a per-sender HKDF subkey. Chrome and Edge use insertable streams;
  Safari uses `RTCRtpScriptTransform` in an inline web worker.
- **Options:** No E2EE. A key-exchange protocol with per-member rotation.
- **Why:** Browsers never send the fragment, so neither the app nor the SFU
  can read media. `lib/e2ee.ts` and the README record the trade-off: everyone
  with the link has the key, and per-member rotation is left as future work.

## 2026-10-13: TURN credentials minted per join, server-side

- **Decided:** When `TURN_CREDENTIALS_URL` and `TURN_API_TOKEN` are set, every
  room-token request fetches short-lived TURN credentials and returns them as
  `iceServers`. A static TURN server is the fallback.
- **Options:** STUN only. Static TURN credentials only.
- **Why:** STUN alone fails on most home and mobile networks. `lib/turn.ts`
  says static credentials are "a standing invitation to use your relay
  bandwidth", while the API token never leaves the server.

## 2026-10-13: Polling for calls and presence

- **Decided:** The dashboard polls incoming calls every 5 s, recent meetings
  every 15 s and notifications every 20 s. The app asks the signaling server
  for live rooms over HTTP.
- **Options:** Push over the signaling WebSocket or server-sent events.
- **Why:** The dashboard holds no socket, and the signaling server only knows
  about rooms. Polling keeps the two processes loosely coupled, at the cost of
  up to 5 s of ring delay and steady request load.

## 2026-10-13: Workspaces are private to one owner

- **Decided:** Each user has one or more workspaces, starting with "Personal".
  Meetings and recordings carry an optional `workspaceId`. The default
  workspace also claims rows that have none. Deleting a workspace returns its
  rows to the default.
- **Options:** Shared team workspaces with members and roles.
- **Why:** `lib/workspace-scope.ts` says rows made before workspaces existed
  have no `workspaceId`, and the default workspace claims them so that history
  does not vanish. The delete dialog promises that meetings and recordings
  stay in the account. Sharing is not built.

## 2026-10-13: Optional meeting time limit, off by default

- **Decided:** Rooms have no time limit unless `MEETING_TIME_LIMIT_MINUTES` is
  set. When it is, the clock counts from the earliest recorded join, people
  get reminders at 15 and 5 minutes, and later token requests get 410.
- **Options:** A fixed limit for everyone. No limit feature at all.
- **Why:** The README makes the cap an operator choice. Ad-hoc rooms get the
  same budget per session, so a bare URL is not a way around it.

## 2026-10-13: Demo mode when MongoDB is not configured

- **Decided:** `getDatabase()` returns `null` without `MONGODB_URI`. Sign-in
  is then unavailable, and guest room links, including the seeded room ids,
  keep working.
- **Options:** Refuse to start without a database.
- **Why:** The project runs from a fresh clone with no credentials. The log
  says plainly that demo mode is on, instead of leaving people to wonder why
  sign-in fails (`lib/mongodb.ts`).

## 2026-10-13: One-line JSON logs with redaction

- **Decided:** The app logs through `lib/logger.ts`, and the signaling server
  uses the same line shape. Secret-like keys and URL credentials are redacted,
  and `apiHandler` makes sure no error path is silent.
- **Options:** Free-form console output. A logging service SDK.
- **Why:** Any host collects console output. Single JSON lines can be filtered
  by level and scope, and redaction keeps database URIs and tokens out of
  logs.

## 2026-10-13: Open source under the MIT licence

- **Decided:** The project is published under MIT and listed on Nucleus
  Explore.
- **Options:** Keep it private. A copyleft licence.
- **Why:** The README presents Meet as an app anyone can run themselves, with
  a "Deploy anywhere" section and a Nucleus listing. MIT puts no conditions on
  reuse beyond keeping the notice.

## 2026-10-13: Vendor-neutral configuration

- **Decided:** Every outside service is addressed by a generic, swappable
  setting:
  - `STORAGE_*`: any S3-compatible bucket.
  - `TURN_CREDENTIALS_URL`: any TURN credential endpoint that takes `{ ttl }`
    and answers `{ iceServers }`.
  - `REALTIME_SFU_*`: any SFU with the sessions/tracks HTTPS API.
  - `NEXT_PUBLIC_TURN_*`: any TURN server, such as your own coturn.
- **Options:** Hard-wire one provider's SDK and names.
- **Why:** Self-hosters can bring their own providers, and the code and docs
  do not tie the project to one vendor.

## 2026-10-13: Security fixes in place at the open-source release

The comments in the code record these fixes. All of them are in the first
public commit:

- The app and signaling server used to disagree on the development secret,
  which broke local token checks. They now share one fallback, and the app
  refuses it in production (`lib/realtime-token.ts`).
- The signaling server compares signatures as byte-length buffers before
  `timingSafeEqual`, so a crafted token cannot throw and crash every live
  room. It also logs `uncaughtException` and `unhandledRejection` instead of
  exiting.
- `GET /rooms` requires the shared secret, because live room ids are invite
  links.
- SFU calls that change a session require the creator's HMAC owner token, so
  one room member cannot push to or close another member's session.
- `sfu-state` messages are rebuilt server-side (at most 8 tracks, capped
  lengths), and messages over 64 KB are dropped.
- The call-action map has a null prototype, so `constructor` and
  `__proto__` cannot pass as actions.
- Only the meeting owner or a participant can ring people into an existing
  room.
- A recording's `publicUrl` must be `https`, under `STORAGE_PUBLIC_URL` when
  that is set.
- `/api/meetings/end` only consults the secret header when present, so a
  missing production secret blocks the signaling path without locking out
  owners.
- The logger redacts secret-like keys and URL credentials.
- TURN API tokens and the SFU app secret never reach browsers.
