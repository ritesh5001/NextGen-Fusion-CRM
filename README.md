# NextGen Fusion CRM — Telecaller Management

A full-stack CRM for **controlling and coordinating telecallers**. A **Superadmin** creates
telecaller accounts (and sets each telecaller's name & daily target), assigns them leads and tasks,
and monitors their work and call outcomes. **Telecallers** log in, see exactly what they have to do,
call their assigned leads (click-to-call), record dispositions, schedule follow-ups, and update task
status.

## Tech stack

- **API** — Node + Express + TypeScript + Mongoose (MongoDB), JWT auth, zod validation.
- **Client** — React + TypeScript (Vite) + Tailwind CSS, TanStack Query, Zustand, Recharts.
  Responsive — works on mobile (bottom nav) and desktop (sidebar).

## Features

- **Roles:** Superadmin & Telecaller (role-based access control).
- **Telecaller management:** create/edit (name, phone, daily target), activate/deactivate, reset
  password, delete — all superadmin-only.
- **Leads:** manual add + **CSV/Excel bulk import**, search/filter, single & bulk assignment.
- **Tasks:** superadmin assigns; telecallers start/complete; overdue highlighting.
- **Calls & dispositions:** telecallers log outcomes; lead status auto-updates; follow-ups auto-created.
- **Follow-ups:** today / overdue / upcoming views with click-to-call.
- **Notifications:** in-app bell for new assignments & completions (polls every 30s).
- **Dashboards:** superadmin KPIs + charts + per-telecaller performance; telecaller daily target
  progress, leads, tasks, follow-ups.
- **Click-to-call:** `tel:` and WhatsApp (`wa.me`) deep links — no paid telephony needed.

## Prerequisites

- Node.js 18+
- MongoDB running locally (`brew services start mongodb-community` on macOS) or a connection string.

## Setup

```bash
# from the repo root
npm run install:all          # installs root, server, and client deps

cp server/.env.example server/.env   # then edit values as needed
npm run seed                 # creates the superadmin, a demo telecaller, and sample leads

npm run dev                  # runs API (:5050) and client (:5173) together
```

Open http://localhost:5173.

### Default seeded logins

| Role        | Email                     | Password     |
| ----------- | ------------------------- | ------------ |
| Superadmin  | admin@nextgenfusion.in       | Admin@12345  |
| Telecaller  | telecaller@nextgenfusion.in  | Tele@12345   |

> Change these via `server/.env` before seeding, and reset passwords from the UI afterward.

## Scripts (root)

| Command               | Description                                   |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | Run server + client concurrently              |
| `npm run dev:server`  | Run only the API                              |
| `npm run dev:client`  | Run only the client                           |
| `npm run seed`        | Seed superadmin / demo data                   |
| `npm run build`       | Production build of server + client           |
| `npm run typecheck`   | Type-check both packages                      |

## Ports

- API: **5050** (macOS uses 5000 for AirPlay Receiver, so we avoid it).
- Client: **5173** (Vite dev server proxies `/api` → `:5050`).

## CSV/Excel import format

Header matching is case/space/punctuation-insensitive and understands common CRM **and Apollo.io
export** columns:

| Lead field | Recognized headers |
| ---------- | ------------------ |
| name       | `Name` / `Full Name`, or `First Name` + `Last Name` |
| phone\*    | `Phone`, `Mobile Phone`, `Work Direct Phone`, `Corporate Phone`, `Other/Home Phone` (first present wins; a second distinct number becomes `altPhone`) |
| email      | `Email` (only kept if it's a valid address — Apollo's "User Managed"/"Unavailable" are dropped) |
| title      | `Title` / `Job Title` / `Designation` |
| company    | `Company` / `Company Name` / `Organization` |
| city/state/country | `City`, `State`/`Province`, `Country` |
| tags       | `Industry` |
| source / notes | `Source` / `Lead Source`, `Notes` / `Remarks` |

\*Phone is required. Phone cells with Excel's leading `'` text-prefix are cleaned automatically. Rows
missing a phone are reported as errors; fully empty rows are skipped silently.

## Project structure

```
server/   Express + TS API (config, models, controllers, routes, middleware, services, validators)
client/   React + TS app  (api, components, features, pages, routes, store, lib, types)
```

See `CLAUDE.md` for full architecture, data models, and the API surface.

## Known advisories

- `xlsx` (SheetJS) has a ReDoS advisory with no npm fix. Import is **superadmin-only**, so risk is
  low. To fully remediate, install SheetJS from its official CDN build.
- The client's `esbuild`/`vite` dev-server advisory affects local dev tooling only (no production
  impact).
