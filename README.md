# Meet

Meet is an open-source, Zoom-style meeting workspace: schedule meetings, ring
people into a call, share an invite link that works without a download, and meet
with camera, microphone, screen sharing, chat and recording, all in the browser.

Built with Next.js 14, MongoDB, any S3-compatible object storage, and a small
self-owned WebSocket signaling server for WebRTC.

Open source under the [MIT licence](LICENSE), and listed on
[Nucleus](https://nucleus.harakumo.com/-/explore).

## Features

- **Meeting rooms** at `/room/[meetingId]`: camera, mic, screen share, active-speaker
  highlight, grid and spotlight layouts, public and private chat, and a participant
  list. Invite links work for signed-out guests.
- **Dashboard**: upcoming and recent meetings with live presence badges, scheduling,
  direct calls that ring the other person, contacts (people you have met with),
  notifications, workspaces, profile with avatar, and recordings.
- **Group calls that scale**: two-person calls run directly between browsers; with an
  SFU configured, everyone opens one connection to the SFU instead of a mesh, with
  simulcast so thumbnails cost a fraction of the bandwidth.
- **End-to-end encrypted rooms**: append `#k=<random-string>` to a room link, or use
  **Invite → Restart this room end-to-end encrypted**.
- **Recording** in the browser, uploaded straight to your storage bucket.
- **Accounts** with hashed passwords and "keep me signed in".
- **Optional meeting time limit**: off by default; set `MEETING_TIME_LIMIT_MINUTES`
  to cap how long a room may run.
- **Installable** as an app (web manifest and install prompt).
- **Demo mode**: runs without any credentials, with seeded meetings.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run dev` starts both halves: the WebSocket signaling server on **:3005** and
the Next.js app on **http://localhost:3001**. (`npm run realtime` runs the
signaling server alone.)

Without `MONGODB_URI` the app runs in demo mode: the dashboard shows seeded meetings,
sign-in is disabled, and guest room links still work. A
`MONGODB_URI is not set` warning in the logs tells you demo mode is active.

## How calls work

The Next.js app issues a short-lived signed room token (`POST /api/realtime/token`,
guests allowed). The browser opens a WebSocket to the signaling server
(`realtime/server.mjs`), which handles room membership, SDP offers and answers, ICE
candidates, chat, and live presence. Media travels over native WebRTC.

`REALTIME_SECRET` must be the same on the app and the signaling server: the app signs
room tokens with it, the signaling server verifies them, and the two use it for their
server-to-server calls (closing a room that has sat empty for `AUTO_END_MINUTES`, and
the live-room list behind the presence badges). In production the app refuses to fall
back to the development secret, so a missing secret fails loudly instead of making
tokens forgeable.

### TURN relay (strongly recommended)

Signaling only introduces the browsers; the media itself travels peer-to-peer (or to
the SFU). With only STUN, calls work on friendly networks but fail on most home and
mobile connections: you see the other person's tile, but their camera and mic never
arrive. Add a TURN relay in one of two ways:

- **Hosted TURN with short-lived credentials**: set `TURN_CREDENTIALS_URL` (the
  service's credential endpoint: it takes a POST of `{ ttl }` with a bearer token and
  answers `{ iceServers }`) and `TURN_API_TOKEN`. Each room join gets fresh
  credentials; the token never reaches a browser.
- **Any TURN server** (for example your own coturn): `NEXT_PUBLIC_TURN_URL`,
  `NEXT_PUBLIC_TURN_USERNAME` and `NEXT_PUBLIC_TURN_PASSWORD`.

Each remote tile shows **Connecting...** until media flows and **Connection failed**
when ICE finds no path. That second state is the signature of a missing TURN relay.

### Group calls (optional SFU)

Without an SFU, rooms use mesh peer-to-peer, which is fine for one-to-one calls and
small groups. For larger calls, set `REALTIME_SFU_API_URL`, `REALTIME_SFU_APP_ID` and
`REALTIME_SFU_APP_SECRET` for a hosted SFU that speaks the sessions/tracks HTTPS API
described in `lib/sfu.ts`. Every participant then opens one connection to the SFU,
pushes their tracks once, and pulls everyone else's. The camera is encoded at three
quality layers and each receiver asks for the layer it needs: the spotlighted tile
streams full quality while filmstrip thumbnails stay light.

The app secret never reaches the browser: clients call `POST /api/sfu`, authenticated
by their signed room token, and only the participant who created an SFU session can
change it.

### End-to-end encryption

In an encrypted room every media frame is AES-GCM encrypted in the browser before it
leaves and decrypted only in the receiving browser. The key lives in the URL fragment,
which browsers never send, so neither this app's servers nor the SFU can read the
media. It needs WebRTC insertable streams (Chrome, Edge, Safari). This is link-key
E2EE: everyone with the link has the key, and per-member key rotation is not
implemented. Recording still works because it captures the already-decrypted tiles in
the recorder's own browser.

## Recording and storage

Recording composites the visible tiles and the mixed audio in the recorder's browser.
The file is uploaded straight to an S3-compatible bucket with a short-lived presigned
`PUT` URL (`POST /api/uploads/sign`), so large media never passes through the app
server. Profile pictures use the same path.

Set `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`,
`STORAGE_ENDPOINT` and `STORAGE_PUBLIC_URL` (the public base URL recordings are played
from). The bucket's CORS policy must allow `PUT` with a `Content-Type` header from your
app's origin. Server-side recording is not offered.

## Meeting time limit (optional)

By default rooms have **no time limit**. To cap them, set `MEETING_TIME_LIMIT_MINUTES`
(for example `120` for two hours). The clock starts at a room's first join; everyone in
the room gets a reminder 15 and 5 minutes before the end, and once time is up the call
ends for everyone and the room stops admitting people (start a fresh room to keep going).
Unset or `0` turns the limit off. The check lives in `app/api/realtime/token/route.ts`.

## Deploy anywhere

Meet is two long-running Node processes:

1. **The app**: `npm run build` then `npm start` (Next.js; listens on `PORT`).
2. **The signaling server**: `npm run realtime`, or deploy the `realtime/` folder on its
   own (it has its own `package.json`; `npm start` there). It listens on `REALTIME_PORT`
   or `PORT`, and needs `REALTIME_SECRET` and `APP_URL` (the app's public address).

Browsers connect to the signaling server at `REALTIME_WS_URL`. Pages are served over
HTTPS in production, so this must be a `wss://` address behind TLS. The signaling
server keeps rooms in memory: run one instance.

## Run Meet on Harakumo

Meet is a Node server app plus its signaling server, so on Harakumo it runs as two
**server apps** (Pro plan and up), not a static site.

1. **Create two projects** at [harakumo.com/dashboard](https://harakumo.com/dashboard)
   → Projects → New project: one for the app, one for signaling.
2. **Create an API key** (Settings → API keys) for the CLI.
3. **Add the environment** (Project → Environment), from `.env.example`:
   - App project:
     - `MONGODB_URI` and `MONGODB_DB`: MongoDB is required for accounts for now
       (without it only guest room links work).
     - `REALTIME_SECRET`: a long random string (`openssl rand -hex 32`).
     - `REALTIME_WS_URL`: `wss://` plus the signaling project's address.
     - `STORAGE_*`: the S3-compatible bucket for recordings and avatars.
     - Optional: TURN (`TURN_CREDENTIALS_URL`, `TURN_API_TOKEN`), the SFU, and
       `MEETING_TIME_LIMIT_MINUTES`.
   - Signaling project: the same `REALTIME_SECRET`, `APP_URL` (the app's `https://`
     address), and optionally `AUTO_END_MINUTES`. Leave `REALTIME_PORT` unset there so
     the server listens on the port it is given.
4. **Deploy** from this folder with the CLI, or ask your AI assistant with the Harakumo
   connector:

   ```bash
   npm i -g @harakumo/cli
   harakumo login --key <your API key>
   harakumo deploy <app project id> .
   harakumo deploy <signaling project id> realtime
   ```

   Every deploy is saved as a commit in the project's private Nucleus repo.

Notes:

- **Your MongoDB must accept the server's connections**: allow its address range, and
  use a database user limited to this database with a long password.
- **Live calls and redeploys**: the signaling server holds rooms in memory, so
  redeploying it drops the signaling connections. Browsers try to reconnect for about
  half a minute.

## Main routes

Pages: `/` (landing page, or the dashboard when signed in), `/meetings`, `/recordings`,
`/contacts`, `/profile`, `/login`, `/signup`, and `/room/[meetingId]`, the meeting room
itself, which is deliberately open to signed-out guests holding an invite link.

- `POST /api/auth/login`: verifies a hashed password and creates an HTTP-only session (honors "keep me signed in")
- `POST /api/auth/register`: creates a MongoDB user with a bcrypt password hash
- `POST /api/auth/logout`: revokes the current session
- `GET /api/auth/me`: returns the current signed-in user
- `GET|POST /api/meetings`: list upcoming / create a meeting
- `GET /api/meetings/recent`: rooms you were recently in, with live presence
- `POST /api/meetings/end`: close a meeting (owner, or the signaling server via the shared secret)
- `GET|POST /api/calls`: poll ringing invites / start a direct call or ring someone into a room
- `PATCH /api/calls/[callId]`: accept, decline, or cancel a call invite
- `GET /api/contacts`: people you have shared meetings with
- `GET /api/notifications`: missed calls, live rooms, fresh recordings
- `GET|PATCH /api/profile`: profile plus usage stats / edit name, username, password, avatar
- `GET|POST /api/workspaces`, `PATCH|DELETE /api/workspaces/[workspaceId]`: workspace CRUD
- `POST /api/realtime/token`: create a signed room token (guests allowed)
- `POST /api/sfu`: the browser's door to the optional SFU
- `GET|POST /api/recordings`: list recordings / save metadata after an upload
- `POST /api/uploads/sign`: create a presigned upload URL for a recording or avatar

## Logging

Everything logs single-line JSON (`{"time", "level", "scope", "message", ...}`) to the
console: the app routes and libraries through `lib/logger.ts`, and the signaling server
in the same shape, so `npm run dev` output reads as one stream. Set
`LOG_LEVEL=debug|info|warn|error` to tune verbosity (default `info`). Secrets and
database credentials are redacted before they reach a log line.

## Licence

MIT. See [LICENSE](LICENSE).
