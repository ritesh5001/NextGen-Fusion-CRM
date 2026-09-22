# CLAUDE.md — NextGen Fusion CRM

Guidance for working in this repository.

## What this project is

NextGen Fusion CRM is a **telecaller management CRM**. Its purpose is to let a **Superadmin** control and
coordinate telecallers: create their accounts (and set each telecaller's name & daily call target),
assign them leads and tasks, and monitor what they're doing and the call outcomes they report.
**Telecallers** log in, see their assigned leads/tasks/follow-ups, place calls (click-to-call),
record dispositions, and update task status.

## Architecture

Monorepo with two independent packages, orchestrated by the root `package.json`:

- **`server/`** — Express + TypeScript REST API (MongoDB via Mongoose). ESM (`"type"` via NodeNext).
- **`client/`** — React + TypeScript SPA (Vite + Tailwind). Mobile + desktop responsive.

The client dev server proxies `/api` to the API. API base path is `/api/v1`.

### Ports
- API: **5050** (avoid 5000 — macOS AirPlay Receiver uses it).
- Client: **5173**.

## Roles & permissions

Two roles (`superadmin`, `telecaller`):

- **Superadmin:** manage telecallers; create/import/assign leads; create/assign/delete tasks; view
  all data; dashboard analytics. No public signup — superadmin creates telecallers.
- **Telecaller:** sees only their own leads/tasks/follow-ups; logs calls; updates task status;
  marks follow-ups done; personal stats.

Enforced by `authenticate` (JWT) + `requireRole(...)` middleware, plus per-document ownership checks
in controllers (telecaller queries are scoped to `assignedTo === req.user.id`).

## Workspaces (multi-tenancy)

The CRM is **multi-workspace**. A **Workspace** is a tenant boundary: each has its own telecallers,
contacts, tasks, calls, follow-ups, notifications, and imports — completely separate from other
workspaces. Every tenant-scoped model carries a required `workspace` ObjectId (see below).

- The **superadmin is global** (no `workspace` field) and shared across all workspaces. They can
  create, rename, switch between, and delete workspaces, and manage each workspace's telecallers/data.
- A **telecaller belongs to exactly one workspace** (`User.workspace`, set at creation). Email is
  globally unique, so each telecaller lives in one workspace only.
- **Twilio/Integration is global (shared)** — one config for all workspaces; per-telecaller caller
  IDs still work per workspace. The Twilio webhook flow is unchanged.

**Active workspace resolution** (`middleware/workspace.ts` → `resolveWorkspace`, runs after
`authenticate`, sets `req.workspaceId`): a telecaller is forced to their own `user.workspace` (any
client header is ignored); the superadmin's active workspace comes from the **`X-Workspace-Id`**
request header (validated; falls back to the earliest workspace). `requireWorkspace` guards data
routes (400 when none resolved). Every data controller filters by `req.workspaceId` and stamps it on
create; get/update/delete use `findOne({ _id, workspace })` so neither role can reach another
workspace's document. The client sends `X-Workspace-Id` via the axios interceptor
(`store/workspace.ts` holds the selection); switching clears the TanStack Query cache and refetches.
Managed from `components/layout/WorkspaceSwitcher.tsx` (admin dropdown; telecaller sees a read-only badge).

**Migrating pre-workspace data:** `npm run migrate:workspaces` creates a **"NextGen Fusion"** workspace
(if none exists) and backfills `workspace` on all existing telecallers/contacts/tasks/calls/follow-ups
(idempotent).

## Data models (`server/src/models`)

Every tenant-scoped model (Lead, Task, CallLog, FollowUp, Notification, ImportBatch) has a required
`workspace` ObjectId; the superadmin is the only workspace-less record.

- **Workspace** — `name, isActive, createdBy`. Tenant boundary (see Workspaces above). Deleting one
  cascades all its data; the last remaining workspace cannot be deleted.
- **User** — `name, email, phone, passwordHash, role, isActive, dailyTarget, twilioNumber, workspace,
  createdBy, lastLoginAt`. `twilioNumber` is the Twilio caller ID the admin assigned this telecaller
  to dial from (''=none). `workspace` is set for telecallers, absent for the superadmin. Methods:
  `setPassword`, `comparePassword` (bcrypt). `passwordHash` is `select:false`.
- **Lead (= Contact)** — the collection stores **all contacts**; `qualified` marks the ones promoted
  to Leads. Fields: `name, phone, altPhone, email, title, company, city, state, country, source, tags,
  status, priority, qualified, callStatus(pending|done|not_done), lastOutcome, remarks[], assignedTo,
  assignedAt, lastContactedAt, nextFollowUpAt, notes, createdBy, importBatch`.
  Statuses: new, assigned, in_progress, interested, callback, not_interested, converted, dnd.
  `remarks[]` is a shared timeline `{ text, by, byName, byRole, createdAt }` both roles append to.
  **Contacts** = all records; **Leads** = `qualified:true` (set when a call outcome is interested/converted).
  **Phone slots are gap-free:** the three numbers (`phone`=phone1, `altPhone`=phone2,
  `altPhone2`=phone3) always fill from the top — phone2 is never blank while phone3 is filled.
  `utils/phoneSlots.ts` enforces it on create/update/import; when a number shifts up it carries its
  `phoneNOutcome`, its `remarks[].phone` tags and its `CallLog.phone` rows with it (`compactLeadPhones`
  in `leadController`). Existing data was backfilled by `scripts/compactPhones.ts`.
- **Task** — `title, description, type(call|follow_up|custom), relatedLead, assignedTo, assignedBy,
  assignedAt, dueDate, priority, status(pending|in_progress|completed|cancelled), startedAt,
  completedAt, completedBy, completionNote, timeSpentMin`. `assignedAt` is when the task reached its
  *current* assignee — stamped on create and re-stamped on reassignment, so it answers "how long has
  this been sitting with them?" rather than `createdAt`'s "when did it first exist?". Tasks created
  before the field have none; the client falls back via `assignedOn(task)`
  (`features/tasks/taskHelpers.ts`), so no backfill is needed. Task dates are **date-only — no clock anywhere** in
  the UI (`fmtDueLabel` / `fmtStamp` render days; the inputs are `type="date"`).
  **`completedAt` is when the work was actually done, not when the button was clicked** — the
  telecaller picks the day inline in the table row (Today / Yesterday chips). A picked day becomes
  an instant via `completionInstant`: today resolves to *now* (never future, never before creation),
  an earlier day to **local noon**, which survives timezone and DST shifts. Build the instant with
  `fromDateInput` rather than `new Date('yyyy-MM-dd')` — the latter parses as UTC midnight and lands
  on the previous day west of Greenwich. The server rejects a future date, or one more than a day
  before the task existed (the grace covers noon-vs-creation-time and client timezone skew).
  Reopening a task clears the whole completion record. Admin assigns to **several users at once**: `assignedTo` accepts an array on
  create and the server fans it out to one task per assignee, so everyone owns their own copy.
- **CallLog** — one row per call activity (so Recents/history is complete): `lead` (**optional** — a
  custom dial to an unsaved number has no contact; see Dialer), `telecaller,
  disposition? (set when connected), callStatus (connected|not_connected|voicemail|incorrect_no),
  notes, durationSec, nextFollowUpAt, phone (phone1|phone2|phone3), phoneNumber, twilioCallSid,
  recordingUrl`. Created by `logCall` (softphone — both done AND not-connected) and by
  `updatePhoneOutcome` (a manual call-status dropdown change also logs a call).
  `DISPOSITION_TO_LEAD_STATUS` maps a disposition → resulting lead status.
- **CallRecording** — `callSid, recordingUrl, durationSec, status, dialStatus`. Staging area for
  async Twilio recording/status/dial-result webhooks, keyed by CallSid; `logCall` attaches the
  recording to the CallLog, and the client polls `dialStatus` to show why a call failed.
- **Integration** — singleton settings doc (`key:'twilio'`): `enabled, accountSid, authToken,
  apiKeySid, apiKeySecret, twimlAppSid, callerId, recordCalls, defaultCountryCode, publicServerUrl`.
  `defaultCountryCode` (e.g. '+91') is prepended to dialled numbers lacking a country code. Managed
  from the admin Integrations panel (secrets never returned raw).
- **FollowUp** — `lead, telecaller, scheduledAt, status(pending|done|missed), notes, callLog`.
- **Notification** — `recipient, type, title, message, link, isRead`.
- **ImportBatch** — `fileName, uploadedBy, totalRows, successCount, errorCount, errors[]`.

## API surface (`/api/v1`)

- **Auth:** `POST /auth/login`, `GET /auth/me`, `PUT /auth/change-password`, `POST /auth/logout`.
- **Workspaces:** `GET /workspaces` (superadmin: all; telecaller: their own), and superadmin-only
  `POST /workspaces`, `PUT /workspaces/:id` (rename), `DELETE /workspaces/:id` (cascade delete;
  blocked on the last one). Not workspace-scoped — these manage the workspaces themselves.
- **Users (superadmin):** `GET/POST /users`, `GET/PUT/DELETE /users/:id`,
  `PATCH /users/:id/status|target|twilio-number|reset-password`. Scoped to the active workspace.
- **Leads/Contacts:** `GET /leads` (use `?qualified=true` for the Leads view, `?callStatus=`, search,
  status filters), `POST /leads`, `GET/PUT/DELETE /leads/:id`, `POST /leads/import`,
  `PATCH /leads/bulk-assign`, `PATCH /leads/:id/assign`, `POST /leads/:id/remarks` (both roles add to
  the shared timeline; telecaller scoped to assigned). Writes/import/assign are superadmin-only;
  telecallers get a scoped `GET`/`PUT`.
- **Tasks:** `GET /tasks` (filters: `search`, `status` — comma-separated for the "To do" tab,
  `priority`, `type`, `assignedTo`, `scope=today|overdue|upcoming|undated`, `sortBy`/`order`;
  default order is open work first, then due date with undated last, then priority — computed in an
  aggregation because Mongo sorts missing dates first), `GET /tasks/stats` (tab/headline counts in
  one `$facet`, ignoring `status`), `POST /tasks` (admin; `assignedTo` may be an array — see Task
  above), `GET /tasks/:id`, `PUT /tasks/:id` (admin; validates a new assignee, notifies on reassign,
  `null` clears `dueDate`/`relatedLead`), `PATCH /tasks/:id/status` (both roles on their own tasks;
  carries `completedAt`/`completionNote`/`timeSpentMin`), `DELETE /tasks/:id` (admin).
  Task notifications link to `/tasks?task=<id>`, which the Tasks page expands as a row;
  `/tasks/:id` redirects there for older notifications.
- **Calls:** `GET /calls` (call history; `?lead=` for one contact; telecaller scoped to own),
  `POST /calls` — telecaller call update: `callStatus: done|not_done`, optional `disposition`
  (required when done), optional `remark` + `nextFollowUpAt`, optional `twilioCallSid`, and `phone`
  (phone1|phone2|phone3) + `phoneNumber` recording *which* number was dialed (so the remark/log
  attach to the right number, not always phone1). Done → logs a CallLog, maps lead status, appends
  remark, maps the disposition onto that number's per-phone CALL STATUS / LEAD STATUS columns +
  stamps `phoneNOutcome.lastCalledAt` (via `DISPOSITION_TO_PHONE_OUTCOME`), and promotes to a Lead
  (`qualified`) when interested/converted. Not-done → marks that number `not_connected`. The
  **Recents** page (`pages/RecentsPage.tsx`) lists recent calls with a scrubbable audio player.
  `POST /calls/save-contact` — promotes a custom-dialled number into a contact after the fact and
  back-links the CallLog already recorded for it (re-applying its disposition/remark to the new
  contact); adopts an existing contact with the same number rather than duplicating it.
  Twilio browser calling (optional, see below): `GET /calls/config` ({enabled}),
  `GET /calls/token` (mints a Voice access token), `GET /calls/:id/recording` (auth-proxied
  recording audio stream — telecaller scoped to own calls); public Twilio webhooks
  `POST /calls/voice` (returns Dial TwiML), `POST /calls/recording`, `POST /calls/status`,
  `POST /calls/dial-status` (Dial `action` callback → records completed/busy/no-answer/failed so the
  client can show *why* a call failed; `GET /calls/dial-status/:callSid` polls it) — all
  signature-verified. Numbers are editable inline by both roles (pencil on the phone actions → `PUT
  /leads/:id`); invalid numbers are caught pre-dial with a prompt to fix.
- **Follow-ups:** `GET /followups?scope=today|upcoming|overdue|all`, `PATCH /followups/:id/done`.
- **Notifications:** `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
- **Reports:** `GET /reports/overview` (admin), `GET /reports/me` (telecaller).
- **Integrations (superadmin):** `GET /integrations/twilio`, `PUT /integrations/twilio` — Twilio
  calling credentials/toggles (secrets masked on read); `GET /integrations/twilio/numbers` — the
  account's voice-capable numbers, for assigning to telecallers.

Response shapes: success → `{ success: true, ... }`; lists → `{ success, data, pagination }`;
errors → `{ success: false, message, details? }` via the central `errorHandler`.

## Server conventions

- Controllers wrap async logic in `asyncHandler` and throw `ApiError.*(...)` for failures.
- Request validation via zod schemas in `validators/` applied with the `validate(schema, source)`
  middleware (replaces `req.body`/merges query).
- Use `idOf(ref)` (`utils/idOf.ts`) when comparing a Mongoose ref that may be populated or raw.
- Notifications are emitted via `services/notificationService.ts` (`notify({...})`).
- Lead import logic lives in `services/importService.ts` (xlsx + header normalization; handles CRM
  and Apollo.io export columns — first/last name, multiple phone columns, apostrophe-cleaning).
- New resource = model → validators → controller → routes → register in `routes/index.ts`.
- **Performance:** models carry workspace-first compound indexes matching the list/stats query
  shapes; list reads use `.lean()`; `getLeadStats` computes all chip counts in one `$facet`
  aggregation (cast ObjectId fields in aggregation `$match` — it doesn't auto-cast like find/count).

## Client conventions

- Server state via **TanStack Query** hooks in `src/api/*` (one file per resource). Global query
  defaults (`main.tsx`): `staleTime: 30s` (revisits render from cache), `placeholderData:
  keepPreviousData` (lists never blank out on filter/page/search changes). Mutations are
  **optimistic** — they patch the cache immediately and roll back on error, then invalidate on
  settle. Reuse `lib/queryPatch.ts` (`patchListItem` / `removeListItem` / `restoreSnapshots`) for
  list mutations; leads/calls have a specialized `patchLeadInLists` (`api/calls.ts`). Debounce
  text-search inputs with `lib/useDebouncedValue.ts` before feeding them to a query.
- Auth/token in **Zustand** (`store/auth.ts`, persisted to localStorage). Axios instance
  (`api/client.ts`) injects the bearer token and logs out on 401.
- Routing in `routes/router.tsx`; guards `ProtectedRoute` / `RoleRoute` in `routes/guards.tsx`.
- Role-aware pages (`pages/*`) branch on `useAuthStore().user.role`; the dashboard renders
  `SuperadminDashboard` or `TelecallerDashboard`.
- Reusable UI in `components/ui/` (Button, Field, Modal, Misc — incl. `Toggle` —, Sheet).
  Feature modals in `features/*`.
- Formatting/click-to-call helpers in `lib/format.ts`; label/color maps in `lib/constants.ts`.
  Country dialling codes/timezones/ISO in `lib/countries.ts`; `<CountryTime>`
  (`components/CountryTime.tsx`) shows a country's live local time (contacts Location cell).
  Phone parsing/formatting in `lib/phone.ts` via **libphonenumber-js**: `formatPhoneDisplay(raw,
  country)` for pretty display (strips junk like leading quotes, formats international), and
  `toE164(raw, country, defaultCode)` for dialling — parses with the contact's country so a number
  that already includes the country code without '+' (e.g. `14102927721`) isn't double-prefixed.
- `@/` is aliased to `client/src/`.

## Theme (matches nextgenfusion.in)

- **Font:** Trap, the site's typeface, self-hosted in `client/public/fonts` (`@font-face` in
  `index.css`) and set as Tailwind's `font-sans`. It has no ₹ or emoji; those fall back to Inter/system.
- **Neutrals are `gray-*`, never `slate-*`** (the site uses Tailwind gray). Canvas `gray-50`, cards
  white with a `gray-200` border and `rounded-2xl`; dark mode is `gray-950`/`gray-900`.
- **Primary actions are black** (`bg-gray-950 text-white`, inverted to white in dark mode) with
  `rounded-btn` (10px), like the site's "Book a Free Call". Active nav items / tabs / chips use the
  same black fill. Don't use `bg-brand-600` for buttons.
- **Brand gradient** `#2B35AB → #8A38F5 → #13CBD4` (`bg-brand-gradient`, `bg-brand-gradient-br`,
  `.text-gradient`) is the accent for headline numbers (`StatCard`), the avatar, toggles, progress
  bars and the login headline. `brand-*` (indigo) stays for focus rings, links and icon tints;
  `fusion.violet` / `fusion.cyan` are the other stops. Chart palettes lead with those three.

## Mobile (the app is used on phones)

Every screen and every action has to work one-handed on a ~390px phone. The rule
is **one layout per breakpoint at `md` (768px)** — the desktop density is kept
behind `md:`, and the phone gets a purpose-built layout rather than a squeezed
copy. `lib/useMediaQuery.ts` (`useIsMobile()`) is for the cases where that means
rendering a *different component*, not a different style; everything else is
Tailwind breakpoints.

- **Navigation** (`components/layout/AppLayout.tsx`): desktop keeps the sidebar;
  the phone gets a five-slot tab bar — four routes plus **More**, a `Sheet`
  holding the *complete* nav, the account row, Customize, the theme switch and
  Log out. Nine tabs do not fit across a phone, so anything without a tab is one
  tap away, never gone. Add a route to `NAV` and it shows up in both.
- **The menu is customizable per user** (`components/layout/NavCustomizer.tsx`,
  opened from *Customize* in the sidebar footer and from the More sheet). Users
  switch off pages they don't use and pin up to `MAX_MOBILE_TABS` routes to
  their phone tab bar; state lives in `ui.ts` as `navHidden`/`navTabs`, **keyed
  by role** so an admin and a telecaller sharing a browser don't inherit each
  other's menu. Always read the menu through `visibleNav(role, hidden)` and
  `tabNav(role, hidden, tabs)` (`nav.ts`) rather than `NAV[role]` directly —
  those apply the fallbacks (an explicit tab choice wins; otherwise
  `MOBILE_PRIMARY` topped up from what's still visible). Hiding is a *menu*
  preference, not a permission: the route keeps working for deep links and
  notifications, and the last visible page can't be switched off.
- **Tables become cards.** `ContactsTable` and `TaskTable` each render a card
  list under `md:hidden` and the table under `hidden md:block` — the same data
  and the same mutations, laid out vertically. The contacts card carries the
  whole call workflow (number, call/WhatsApp/copy/edit, call status, lead
  outcome, remark) per phone slot, with phone 2/3 folded behind a count.
- **Safe areas & the tab bar.** `main` uses `pb-navbar` and the tab bar `pb-safe`
  (both in `index.css`) so content clears the bar and the iPhone home indicator.
  `CallBar` floats *above* the tab bar on a phone so navigation stays reachable
  mid-call.
- **iOS never auto-zooms:** `index.css` forces `font-size:16px` on every
  `input`/`select`/`textarea` under 768px. Safari zooms the page whenever a
  focused control is smaller than that and never zooms back — with this app's
  wall of inline `text-xs` controls that was the single worst phone bug. The
  dense desktop table is `hidden` at that width, so nothing there is affected.
- **Touch targets:** `Button`'s `sm`/`md` sizes carry a phone minimum that
  resets at `md:`; the `Field` primitives get `min-h-11 md:min-h-0`; bespoke
  icon buttons use the `.tap` utility (44px, `pointer: coarse` only).
- **Overlays:** `components/ui/Sheet.tsx` is the phone-native bottom sheet (nav
  overflow, contact filters) and exports `useBodyScrollLock`, which `Modal` also
  uses — without it iOS scrolls the page behind the sheet. `Modal` already
  renders as a bottom sheet under `sm`; its footer buttons go full-width there.
- **Expanding a row scrolls it into view** (task completion strip, contact
  detail) — otherwise the panel opens below the fold and the tap looks dead.
- **Colour maps in `lib/constants.ts` must carry `dark:` pairs.** On desktop
  they're small badges; on a phone card they are full-width selects, so a
  missing dark variant is a white block on a dark screen.
- **Verifying:** drive it with Playwright at `devices['iPhone 13']` and at a
  360px viewport, and assert `documentElement.scrollWidth <= clientWidth` on
  every route — horizontal page overflow is always a bug (wide content scrolls
  inside its own `overflow-x-auto` container).

## Commands

```bash
npm run install:all        # install all deps
npm run seed               # seed superadmin + default workspace + demo data
npm run migrate:workspaces # one-time: move pre-workspace data into "NextGen Fusion"
npm run migrate:phones     # one-time: close gaps in the phone1/2/3 slots (--dry-run to preview)
npm run dev                # API (:5050) + client (:5173)
npm run build              # build both
npm run typecheck          # tsc --noEmit in both packages
```

Seeded logins: `admin@nextgenfusion.in / Admin@12345`, `telecaller@nextgenfusion.in / Tele@12345`.

## Environment (`server/.env`)

`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, and
`SUPERADMIN_NAME/EMAIL/PASSWORD` (seed). Twilio is **not** configured via env (see Telephony); the
only related var is the optional `PUBLIC_SERVER_URL` webhook fallback. See `server/.env.example`.

## Telephony (Twilio browser softphone)

Optional. Twilio is configured at runtime from the **admin panel** (superadmin → Integrations,
`pages/IntegrationsPage.tsx`), persisted to the `Integration` singleton (`key:'twilio'`), **not** env
vars. When `enabled` + all creds are present, clicking **Call** dials the lead from the telecaller's
browser via the **Twilio Voice JS SDK** (`@twilio/voice-sdk`); otherwise Call falls back to plain
`tel:` links. **Per-user caller IDs:** the admin assigns each telecaller a Twilio number on the
Integrations page (`User.twilioNumber`, via `PATCH /users/:id/twilio-number`); a telecaller can only
call if they have one (superadmin falls back to the integration's default `callerId`). `GET
/calls/config` and `/calls/token` are gated by `resolveCallerId(userId)`; the voice webhook derives
the caller from `From` (`client:<userId>`) and dials with that user's number. Flow: client mints a
token (`GET /calls/token`) and creates a `Device` (`client/src/store/call.ts`), connects with the
lead's number → Twilio fetches Dial TwiML from `POST /calls/voice` → audio in the browser
(`features/calls/CallBar.tsx`) → on hangup the
`CallDispositionModal` logs the outcome via the existing `POST /calls` (with `twilioCallSid` +
auto-measured duration). Recording is a panel toggle; when on, Twilio's `POST /calls/recording`
webhook stages the recording in the `CallRecording` collection (keyed by CallSid) which `logCall`
attaches to the CallLog. Playback: recordings are streamed back through `GET /calls/:id/recording`

(server fetches the Twilio media with Basic auth and proxies it — creds never reach the browser);
the client downloads it as a blob and plays it (`features/calls/CallHistory.tsx`, shown in the
expanded contact row). Server bits: `services/twilioService.ts` reads settings from the DB per
request (token/TwiML/signature); webhooks are signature-verified in `routes/callRoutes.ts`; admin
CRUD in `controllers/integrationController.ts` (secrets masked on read — `authToken`/`apiKeySecret`
returned only as `*Set` flags). One-time Twilio-console setup: create an API Key + a TwiML App whose
Voice URL is the panel's shown `voiceWebhookUrl` (`https://<server>/api/v1/calls/voice`); set the
panel's "Public server URL" (or `PUBLIC_SERVER_URL`) so recording webhooks resolve — use ngrok
locally.

## Telephony provider #2 — TeleCMI

TeleCMI runs **alongside** Twilio; both stay configured and each user picks which one they dial with.

**Which TeleCMI product:** this targets their **cloud phone system** (docs: "CHUB"), administered from
the **Connle** dashboard (`connle.telecmi.com`) — *not* PIOPIY, their separate programmable-telephony
platform (`developer.telecmi.com`). Don't follow PIOPIY docs for this integration.

**Which CHUB region — this matters, every endpoint differs.** TeleCMI runs two CHUB platforms and there
is no shared base URL; a wrong region fails auth rather than erroring usefully. `apiRegion`
(`india`|`global`, default `india`) selects the set in `services/telecmiService.ts`:

| | India (`doc.telecmi.com/chub-india`) | Global (`doc.telecmi.com/chub`) |
|---|---|---|
| agent login | `piopiy.telecmi.com/v1/agentLogin` | `rest.telecmi.com/v2/user/login` |
| click-to-call | `piopiy.telecmi.com/v1/agentConnect` | `rest.telecmi.com/v2/click2call` |
| recording | `piopiy.telecmi.com/v1/play` | `rest.telecmi.com/v2/play` |
| analysis | `piopiy.telecmi.com/v1/analysis` | `rest.telecmi.com/v2/analysis` |
| secret param | `token` | `secret` |

Don't guess the region — the panel's **Test & detect** button (`POST /integrations/telecmi/detect` →
`detectApiRegion`) posts the app id + secret to *both* Analysis APIs and selects whichever returns
`code:200`. Note the probe must send `start_date`/`end_date`: Global schema-checks before it
authenticates, so omitting them 400s regardless of credentials.

- **Config** (`Integration` doc `key:'telecmi'`, admin panel → `features/integrations/TelecmiPanel.tsx`):
  `enabled, appId, apiSecret (secret), apiRegion, sbcUri, recordCalls, defaultCountryCode, publicServerUrl`.
  `GET/PUT /integrations/telecmi` (secret masked as `apiSecretSet`). App ID + API secret come from Connle.
- **Per-telecaller agent:** `User.telecmiUserId` + `telecmiPassword` (both `select:false` for the
  password, also stripped in `toJSON`), assigned via `PATCH /users/:id/telecmi`. A blank password
  keeps the stored one. `User.callProvider` holds the user's preference (`PATCH /calls/provider`,
  self-service — telecallers set their own).
- **Softphone (WebRTC):** `@telecmi/piopiyjs`. Unlike Twilio there is **no server-minted token and no
  TwiML webhook** — the browser registers with the regional SBC using the agent's SIP password, which
  `GET /calls/telecmi/credentials` hands to that user only (scoped to `req.user`).
  SBCs: `sbcind`/`sbcus`/`sbcuk`/`sbcsg`.
- **Click-to-call:** `POST /calls/telecmi/click-to-call` → TeleCMI rings the telecaller's own phone,
  then bridges the lead. Uses an agent token from `/v1/agentLogin` (valid 30 days, cached on the User
  doc and auto-refreshed once on failure). No browser audio, so no keypad/mute/live controls.
- **CDR webhook:** `POST /calls/telecmi/cdr` (public). TeleCMI does **not** sign its callbacks, so the
  handler authenticates by matching the configured `appid` on the payload (the CDR carries it). Register
  the panel's shown `cdrWebhookUrl` in Connle under **Settings → Webhooks** → pick the business number →
  add → type **call report**, method **POST**.
- **Recordings** are referenced by *file name* (`CallLog.recordingFile`) and streamed through the same
  `GET /calls/:id/recording` proxy, which branches on `CallLog.provider`.
- `CallLog` carries `provider (twilio|telecmi)`, `mode (softphone|click_to_call)`, `telecmiCallId`,
  `telecmiRequestId`. Client state lives in the same `store/call.ts`, which branches per provider;
  `features/calls/useCallProvider.ts` is the single source of truth for "which backend am I on" and
  `ProviderSwitcher.tsx` is the UI.

## Dialer, DTMF & custom calls

- **Dialer** (`pages/DialerPage.tsx`, `/dialer`, both roles) places a call to any number that isn't a
  saved contact. Numbers are normalized with `toE164`; a local number typed without a country code
  can only be resolved when the integration's `defaultCountryCode` is set, so the dialer says which
  is missing rather than just refusing to dial.
- **DTMF / IVR**: `useCallStore.sendDigit(d)` wraps Twilio's `call.sendDigits`, gated to `phase ===
  'in_call'` (Twilio drops tones sent while ringing). The keypad (`features/calls/Keypad.tsx`) is
  shared by the dialer and the in-call panel in `CallBar`; while it's open the physical number row
  types DTMF straight through.
- **Custom calls have no contact.** `CallLog.lead` is optional and `logCall` skips all lead mutation
  when it's absent, so the call + outcome are always recorded (validator requires *either* `lead` or
  `phoneNumber`). After logging, `SaveCustomContactModal` offers a **skippable** save-as-contact
  step; skipping leaves the call in Recents labelled "Not saved as a contact". Anything rendering a
  CallLog must handle `lead: null`.
- In dev builds only, `window.callStore` exposes the softphone store (state is otherwise unreachable
  outside a live call); `import.meta.env.DEV` strips it from production bundles.

## Tasks UI (no dialogs)

`pages/TasksPage.tsx` is a **table**, and every task action happens inline — there are no modals:

- **`features/tasks/TaskComposer.tsx`** — the whole assign flow lives in a bar above the table.
  Type a title, pick people from a native `<select>` (each pick becomes a removable chip, so one
  task fans out to several users), optionally set due/priority/type, press **Enter**.
- **`features/tasks/TaskTable.tsx`** — assignee, priority and status are in-cell `<select>`s that
  save instantly (`useUpdateTask` patches the cache optimistically). Choosing *Completed*, or
  clicking the row's tick, expands a **completion strip** in a second `<tr>` where the telecaller
  reports *when* they did it, the time spent and a note. The chevron expands a **details row**
  (admin edits title/details/due/type in place; both roles see the completion record).
- Columns are Done · Task · [Assignee] · **Assigned** · Due · Priority · Status · Completed ·
  Actions. Their fixed widths total ~55rem, so the table sets `min-w-[66rem]` inside an
  `overflow-x-auto` wrapper — otherwise the Task column starves and titles wrap one word per line.
  Below ~1400px the table (not the page) scrolls. The expanded completion/details `<tr>` uses a
  `colSpan` counted from the columns actually rendered (9 admin / 8 telecaller) — hardcoding it
  silently truncates the panel for whichever role has fewer columns.
- Badge colour maps in `lib/constants.ts` carry explicit `dark:` pairs — the app is used in dark mode.

## Notes for future work

- Incoming calls aren't handled (the VoiceGrant is `incomingAllow:false`); add browser inbound +
  call transfer behind `twilioService` later if needed.
- `xlsx` has an unpatched npm ReDoS advisory; import is superadmin-only. Consider the SheetJS CDN
  build if hardening is needed.
- Notifications poll every 30s; could move to WebSockets/SSE for realtime.
