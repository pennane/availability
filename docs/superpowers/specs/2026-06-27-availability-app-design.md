# Availability App — Design Spec

## Overview

When2meet-style availability polling tool with polished UI. A host creates an event, shares a single link, and participants mark their availability on a time-slot grid. Mobile-first, accessible, real-time.

## Monorepo Structure

```
api/        — OpenAPI 3.1 spec (YAML), codegen config, generated types
server/     — Go module (chi + SQLite + WebSocket)
web/        — React SPA (Vite), deployed to Vercel
```

The OpenAPI spec in `api/` is the single source of truth for the API contract. Go server types and TypeScript client types are both generated from it. `web/` is managed with pnpm. Go and JS ecosystems are separate — no shared package manager.

## API Contract

### OpenAPI Spec

The `api/` directory contains:
- `openapi.yaml` — the spec
- Generated Go types + chi server interface (via oapi-codegen)
- Generated TypeScript types (via openapi-typescript)

Discriminated unions are modeled with `oneOf` + `discriminator` in the spec. openapi-typescript produces proper TS union types. oapi-codegen produces Go wrapper types; the handler layer maps between Go domain types and generated types.

### WebSocket Messages

WebSocket is not covered by OpenAPI. The message types are hand-maintained on both sides — the surface is small (4 message kinds, notification-only):

```typescript
type EventMessage =
  | { kind: 'availability-updated'; participantId: string }
  | { kind: 'participant-joined'; participantId: string; name: string }
  | { kind: 'date-suggested'; eventDateId: string; date: string }
  | { kind: 'settings-changed' }
```

Go equivalent:

```go
type EventMessage struct {
    Kind          string `json:"kind"`
    ParticipantID string `json:"participantId,omitempty"`
    Name          string `json:"name,omitempty"`
    EventDateID   string `json:"eventDateId,omitempty"`
    Date          string `json:"date,omitempty"`
}
```

### Routes

```
POST   /events                       — create event → { eventId, hostToken }
GET    /events/:id                   — polymorphic on token role:
                                       no token → public info + join prompt
                                       participant → event + own availability + others (visibility-scoped)
                                       host → full admin view
PATCH  /events/:id                   — host: update mutable settings (see Mutability below)
                                       standard PATCH: omitted fields are left unchanged
                                       client sends desired state, e.g. { visibility: "anonymous" }
                                       server diffs against current and performs variant swaps
                                       within a transaction

POST   /events/:id/me                — join event (provide name) → returns participantToken
GET    /events/:id/me                — own participation state
PATCH  /events/:id/me                — update name / note
PUT    /events/:id/me/availability   — replace full availability set

POST   /events/:id/dates             — suggest a date (if suggestion policy is open)
                                       returns existing date ID if duplicate (UNIQUE constraint)
```

### Event Field Mutability

After creation, event fields fall into two categories:

**Mutable via PATCH:**
- `title`
- `description`
- `visibility` (variant swap)
- `suggestion_policy` (variant swap)

**Immutable after creation:**
- `timezone` — shifts the meaning of all stored datetimes
- `slot_duration_minutes` — invalidates existing availability (slots no longer align)
- `time_range_start` / `time_range_end` — orphans availability outside the new window

These fields define the grid structure. Once participants submit availability against the grid, changing them would corrupt responses. The server rejects PATCH requests that include immutable fields.

### Token Flow

1. Host creates event → gets URL `/events/:eventId/:hostToken`
2. Host shares plain URL `/events/:eventId` with participants
3. Participant opens link → sees join page → enters name → `POST /events/:id/me` → receives token
4. Frontend stores token in `localStorage` keyed by `eventId`
5. All subsequent API calls use `Authorization: Bearer <token>`
6. Participant can return later — token is already in storage

## Domain Types

### Go — Sealed Interfaces

Discriminated unions in Go use the sealed interface pattern: an interface with an unexported method. Each variant is a struct implementing it. Consumers use type switches; the `exhaustive` linter catches missing cases.

```go
type VisibilityPolicy interface {
    visibilityPolicy()
}

type NamesVisibleVisibility struct{}
type AnonymousVisibility struct{}

func (NamesVisibleVisibility) visibilityPolicy() {}
func (AnonymousVisibility) visibilityPolicy()    {}
```

The repository layer reads variant tables and returns sealed interfaces. The handler layer maps sealed interfaces to oapi-codegen generated types for HTTP responses. These are separate concerns — the repository knows which table had a row, the handler knows the wire format.

Same pattern for: `SuggestionPolicy`, `EventDateOrigin`, `AvailabilityKind`.

### TypeScript — Generated from OpenAPI

TypeScript types are generated by openapi-typescript from the OpenAPI spec. Discriminated unions use `oneOf` + `discriminator` in the spec, producing proper TS union types. The openapi-fetch client is fully type-safe against these generated types.

### IDs

All entity IDs (events, participants, event dates, availability) are **UUIDv7** — time-ordered for sequential SQLite B-tree inserts. Tokens (host and participant) are **128-bit entropy, base64url encoded**.

## Data Model

Class table inheritance throughout — each discriminated union variant is its own table. No booleans, no JSON columns, no `kind` text columns. The existence of a row in a variant table is the discriminant.

### Integrity Rules

- `PRAGMA foreign_keys = ON` at every connection.
- `PRAGMA journal_mode = WAL` at every connection — required for concurrent reads while writing.
- All variant table foreign keys use `ON DELETE CASCADE`.
- Variant exclusivity enforced via `BEFORE INSERT` triggers: each variant table's trigger checks that no row exists in the sibling table for the same key. Repository-layer variant swaps (DELETE + INSERT) are wrapped in explicit SQL transactions.
- Tokens are 128-bit entropy, base64url encoded.
- Entity IDs are UUIDv7.

### Temporal Formats

- `time_range_start`, `time_range_end`: time-of-day in `HH:mm` format, in the host's timezone. These define the daily template for slot generation.
- `slot` in `availability`: full ISO 8601 local datetime in the host's timezone, e.g. `2026-07-15T22:00`. When the time range crosses midnight (`end < start`), slots wrap into the next calendar day — e.g. a 22:00–02:00 range on 2026-07-15 produces slots from `2026-07-15T22:00` through `2026-07-16T01:30`. The full datetime eliminates midnight-crossing ambiguity.
- `date` in `event_dates`: calendar date in `YYYY-MM-DD` format.
- `created_at`: ISO 8601 UTC.

### Timezone Handling

Each event stores the host's IANA timezone (e.g. `Europe/Helsinki`). `time_range_start` and `time_range_end` are time-of-day templates in the host's timezone. Slots are stored as full datetimes in the host's timezone. The frontend defaults to displaying the host's times, with an optional "show in my timezone" toggle that converts client-side using `Intl.DateTimeFormat`. The grid component is timezone-agnostic — it renders whatever datetimes it's given.

### Events

```sql
events
  id                    TEXT PRIMARY KEY
  title                 TEXT NOT NULL
  host_token            TEXT NOT NULL UNIQUE
  description           TEXT
  timezone              TEXT NOT NULL
  slot_duration_minutes INTEGER NOT NULL CHECK(slot_duration_minutes IN (15, 30, 60))
  time_range_start      TEXT NOT NULL
  time_range_end        TEXT NOT NULL
  created_at            TEXT NOT NULL
```

### Visibility Policy (one row per event in exactly one variant)

```sql
names_visible_visibility
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE

anonymous_visibility
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
```

Triggers: `BEFORE INSERT` on `names_visible_visibility` rejects if `anonymous_visibility` has a row for the same `event_id`, and vice versa.

### Suggestion Policy

```sql
open_suggestion_policy
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE

closed_suggestion_policy
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
```

Triggers: same exclusivity pattern as visibility.

### Event Dates

```sql
event_dates
  id          TEXT PRIMARY KEY
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE
  date        TEXT NOT NULL
  UNIQUE(event_id, date)
  UNIQUE(id, event_id)

host_suggested_dates
  event_date_id TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE

participant_suggested_dates
  event_date_id    TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE
  participant_id   TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE
```

Triggers: `BEFORE INSERT` on `host_suggested_dates` rejects if `participant_suggested_dates` has a row for the same `event_date_id`, and vice versa.

### Participants

```sql
participants
  id          TEXT PRIMARY KEY
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE
  name        TEXT NOT NULL
  token       TEXT NOT NULL UNIQUE
  note        TEXT
  UNIQUE(id, event_id)
```

### Availability

```sql
availability
  id              TEXT PRIMARY KEY
  participant_id  TEXT NOT NULL
  event_date_id   TEXT NOT NULL
  event_id        TEXT NOT NULL
  slot            TEXT NOT NULL
  UNIQUE(participant_id, event_date_id, slot)
  FOREIGN KEY (participant_id, event_id) REFERENCES participants(id, event_id)
  FOREIGN KEY (event_date_id, event_id) REFERENCES event_dates(id, event_id)

available_availability
  availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE

if_needed_availability
  availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE
  reason          TEXT
```

The composite foreign keys on `availability` ensure a participant can only have availability on dates belonging to the same event. `event_id` is denormalized for this purpose.

Triggers: `BEFORE INSERT` on `available_availability` rejects if `if_needed_availability` has a row for the same `availability_id`, and vice versa.

Absence of an availability row = unavailable. No third variant needed.

### Indexes

```sql
CREATE INDEX idx_availability_event_date_id ON availability(event_date_id);
CREATE INDEX idx_availability_event_id ON availability(event_id);
CREATE INDEX idx_event_dates_event_id ON event_dates(event_id);
CREATE INDEX idx_participants_event_id ON participants(event_id);
```

## Server Architecture

### Stack

- Go
- chi (HTTP router)
- modernc.org/sqlite (pure Go SQLite, no CGO)
- nhooyr.io/websocket or gorilla/websocket
- oapi-codegen (generates chi server interface + types from OpenAPI)

### Module Structure

```
server/
  cmd/server/     — main.go, wires dependencies, starts HTTP
  internal/
    handler/      — implements oapi-codegen's ServerInterface, maps domain types ↔ generated types
    service/      — business logic, receives repositories as arguments
    repository/   — SQLite queries, one per aggregate, returns domain types (sealed interfaces)
    domain/       — sealed interface definitions, domain types
    ws/           — WebSocket broadcast channel
    db/           — connection setup, migrations, PRAGMA config
  go.mod
  go.sum
```

### Layer Responsibilities

- **`domain/`** — defines sealed interfaces (`VisibilityPolicy`, `SuggestionPolicy`, etc.) and domain structs. No dependencies on other packages.
- **`repository/`** — reads variant tables, returns domain types. Knows which table had a row → returns the correct sealed interface variant.
- **`service/`** — business logic using domain types. Receives repositories as interfaces.
- **`handler/`** — implements oapi-codegen's `ServerInterface`. Maps between domain types and oapi-codegen generated types for HTTP request/response.

### Dependency Injection

Services are structs that receive their dependencies at construction:

```go
type EventService struct {
    events    EventRepository
    broadcast *BroadcastChannel
}

func NewEventService(events EventRepository, broadcast *BroadcastChannel) *EventService {
    return &EventService{events: events, broadcast: broadcast}
}
```

Repositories are interfaces. Production uses SQLite implementations; tests use in-memory SQLite with the same implementations (real DB, no mocks).

### CORS

The server must allow cross-origin requests from the Vercel frontend. chi middleware handles:
- `Access-Control-Allow-Origin` set to the configured frontend URL (not `*`)
- `Access-Control-Allow-Headers: Authorization, Content-Type`
- `Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS`
- Preflight `OPTIONS` requests handled automatically

The allowed origin is configured via environment variable.

## Deployment

### Backend (VPS)

Single binary deployment. No Docker, no Node.js runtime.

```
# Build (local machine or CI)
GOOS=linux GOARCH=amd64 go build -o availability-server ./cmd/server

# Deploy
scp availability-server user@vps:~/
ssh user@vps 'chmod +x availability-server'
```

The binary is self-contained: embeds SQLite (pure Go), serves HTTP + WebSocket.

**HTTPS**: Caddy as a reverse proxy with automatic Let's Encrypt TLS. Minimal config:

```
availability-api.yourdomain.com {
    reverse_proxy localhost:8080
}
```

Caddy auto-provisions and renews certificates. The Go server listens on localhost only.

**Process management**: systemd unit file:

```ini
[Unit]
Description=Availability Server
After=network.target

[Service]
ExecStart=/home/user/availability-server
Environment=PORT=8080
Environment=DATABASE_PATH=/home/user/data/availability.db
Environment=ALLOWED_ORIGIN=https://availability.yourdomain.com
WorkingDirectory=/home/user
Restart=always

[Install]
WantedBy=multi-user.target
```

**SQLite persistence**: the database file path is configured via environment variable. Lives outside the binary directory. Backup: periodic `sqlite3 .backup` cron job or `litestream` for continuous replication.

### Frontend (Vercel)

Standard Vite + React deployment. The API URL is configured via Vercel environment variable:

```
VITE_API_URL=https://availability-api.yourdomain.com
```

### Configuration

All runtime config via environment variables:

| Variable | Server | Description |
|---|---|---|
| `PORT` | yes | HTTP listen port (default: 8080) |
| `DATABASE_PATH` | yes | SQLite file path (default: ./availability.db) |
| `ALLOWED_ORIGIN` | yes | Frontend URL for CORS |
| `VITE_API_URL` | web | Backend API URL (build-time) |

## Real-time

WebSocket as notification bus, not data transport.

- Client connects to `wss://.../events/:id/live?token=<token>`
- Server validates token, subscribes client to event broadcast channel
- Server broadcasts typed messages on state changes (see WebSocket Messages above)
- Client receives notification → invalidates relevant TanStack Query cache → refetch
- No granular diffs, no conflict resolution, no message ordering concerns
- Reconnect with exponential backoff; full state refetch on reconnect

## Frontend Architecture

### Stack

- React + TypeScript
- TanStack Query (data fetching + cache)
- TanStack Router (type-safe routing)
- React Aria (accessibility primitives)
- Tailwind CSS
- Vite (build)
- openapi-typescript + openapi-fetch (generated types + type-safe API client)

### Feature-Sliced Structure

```
web/
  src/
    features/
      join/         — public landing, name input, create participation
      grid/         — calendar grid component (drag-paint, touch, a11y)
      results/      — per-person row view of availability
      event-config/ — host: create event, manage settings
    shared/
      api/          — openapi-fetch client, token management, WebSocket hook
      ui/           — base components (React Aria)
      routing/      — router setup, token extraction from URL
```

Features never import from other features. Shared concerns go in `shared/`.

### Grid Component

- Built on React Aria (useGridCell, keyboard navigation, focus management)
- Touch interaction via pointer events (device-agnostic drag-paint)
- Three cell states: available, if-needed, empty (unavailable)
- Controlled component: parent passes state in, gets change callbacks out
- Mobile-first: touch is the primary interaction, desktop adapts
- Timezone-agnostic: renders whatever datetimes it receives; conversion happens upstream

### State Management

No global store. Each feature owns its state via React hooks. WebSocket connection lives in shared context. Features communicate through URL (routing) and shared query cache (TanStack Query).

## Testing

### `server/`

Integration tests in Go against real in-memory SQLite. Test HTTP handlers and WebSocket behavior. No DB mocking — repositories are tested with the same SQLite driver. `go test ./...`

### `web/`

- Component tests: Vitest + React Testing Library (grid interactions, touch, keyboard)
- Visual regression: Loki + Storybook for the grid component:
  - Across viewport sizes (mobile-first)
  - Three-state cell rendering
  - Drag-paint selection feedback
  - Focus/hover states

### Not needed at this stage

- E2E tests — integration tests on both sides cover critical paths
- Snapshot tests for non-visual components

## Deferred

- Event deletion / expiration / lifecycle management
- Email invitations (Resend or AWS SES)
- Rate limiting (per-IP on event creation, per-event on participant joins)
- Mutable grid structure (changing timezone, slot duration, time range after creation)

## Design Principles

- One-click-ness: minimum friction for every interaction
- Mobile-first: touch is primary, desktop adapts
- Browser-native first: `<dialog>`, Popover API, Intl, pointer events before library equivalents
- Accessible: WCAG compliance via React Aria, all elements keyboard-navigable
- Functional where it helps: pure functions for data transforms on the frontend; interfaces + composition on the Go side
- No premature abstraction: three similar lines beats a premature helper
