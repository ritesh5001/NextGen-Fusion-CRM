---
name: verify
description: Build, run, and drive the NextGen Fusion CRM in a real browser to observe a change working end-to-end.
---

# Verifying NextGen Fusion CRM

## Launch

```bash
npm run dev    # API :5050 + client :5173 together (run in background)
```

Wait for both before driving — poll rather than sleeping blindly:

```bash
for i in $(seq 1 60); do
  api=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5050/api/v1/auth/me)
  cli=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/)
  [ "$cli" = "200" ] && [ "$api" != "000" ] && { echo READY; break; }
  sleep 1
done
```

`401` from `/auth/me` is the healthy unauthenticated response, not a failure.

Mongo is a **remote Atlas cluster** (`MONGODB_URI` in `server/.env`) — no local
`mongod` needed, but the data is shared/real. Clean up anything you create.

## Logins

`admin@nextgenfusion.in / Admin@12345` works. **The seeded telecaller
(`telecaller@nextgenfusion.in`) does not exist in the Atlas DB** — create one via the
API and delete it afterwards:

```bash
TOKEN=$(curl -s -X POST http://localhost:5050/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@nextgenfusion.in","password":"Admin@12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
WS=$(curl -s http://localhost:5050/api/v1/workspaces -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["_id"])')
# create: POST /api/v1/users with Authorization + X-Workspace-Id headers, role=telecaller
# delete: DELETE /api/v1/users/<id> with the same headers
```

Every data request needs **both** `Authorization: Bearer` and `X-Workspace-Id`.
Don't name a shell var `UID` in zsh — it's reserved and the assignment errors.

## Driving the UI

Playwright isn't a dependency; use it via npx (`npx playwright@1.61.1`,
`npx playwright install chromium`) and drive `http://localhost:5173`.

For anything touching the **softphone or audio**, launch Chromium with fake media
so you get real devices and a real tone without hardware:

```js
chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
browser.newContext({ permissions: ['microphone'] })
```

That yields "Fake Audio Input 1/2" devices and a signal that moves a level meter.

## Gotchas worth knowing

- **`deviceId` from `enumerateDevices()` rotates on every page load.** Never
  persist it as an identity key — persist the device *label* and re-resolve the id
  (this is what `store/audio.ts` does).
- Device **labels are empty until mic permission is granted**, so any logic that
  prunes/matches devices must gate on `permission === 'granted'`.
- `navigator.permissions.query({name:'microphone'})` resolves async and can land
  *after* a grant — don't let it clobber the newer state.
- Twilio calling is configured per-workspace in the DB, not env. A telecaller with
  no `twilioNumber` correctly shows "Not set up" on the Device Test page.
- **Vite does not always pick up edits mid-session.** If a driver script sees stale
  behaviour, check `curl -s http://localhost:5173/src/<file> | grep <new-symbol>`
  before debugging the code — restart `npm run dev` if it's missing.
- The real Twilio media path can't connect from a test env. To drive call UI
  (CallBar, DTMF, disposition modal), set state directly on the dev-only store:
  `window.callStore.setState({ phase: 'in_call', call: stubCall, ... })` with a
  stub exposing `sendDigits`/`mute`/`disconnect`/`on`.
- `defaultCountryCode` is empty on this install, so local numbers without a `+`
  won't validate in the dialer — use full E.164 (`+1415…`) when driving it.
