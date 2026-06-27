# Availability App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a When2meet-style availability polling app with a Go backend and React frontend, connected via an OpenAPI-generated contract.

**Architecture:** Monorepo with three top-level dirs: `api/` (OpenAPI spec + codegen), `server/` (Go + chi + SQLite), `web/` (React + Vite + TanStack). The OpenAPI spec is the single source of truth. Go uses sealed interfaces for discriminated unions. SQLite uses class table inheritance with BEFORE INSERT triggers for variant exclusivity.

**Tech Stack:** Go 1.22+, chi, modernc.org/sqlite, oapi-codegen, React 18, TypeScript, Vite, TanStack Query + Router, React Aria, Tailwind CSS, openapi-typescript + openapi-fetch, Vitest, Storybook + Loki

## Global Constraints

- Entity IDs: UUIDv7 everywhere
- Tokens: 128-bit entropy, base64url encoded
- Temporal formats: slots are full ISO datetime in host timezone (`2026-07-15T22:00`), dates are `YYYY-MM-DD`, time ranges are `HH:mm`
- SQLite PRAGMAs: `foreign_keys = ON`, `journal_mode = WAL` at every connection
- All variant FKs: `ON DELETE CASCADE`
- Go discriminated unions: sealed interface pattern (unexported method)
- Frontend: features never import from other features
- No booleans, no JSON columns, no `kind` text columns in the DB

---

### Task 1: OpenAPI Spec + Codegen Pipeline

**Files:**
- Create: `api/openapi.yaml`
- Create: `api/oapi-codegen.yaml`
- Create: `api/generate.sh`
- Create: `api/package.json` (for openapi-typescript)
- Create: `Makefile`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `api/openapi.yaml` (consumed by all other tasks), `api/generate.sh` (generates Go + TS types)

- [ ] **Step 1: Create root `.gitignore`**

```gitignore
# Go
server/availability-server
server/tmp/

# Node
node_modules/
web/dist/

# Generated (re-generate with `make generate`)
server/internal/generated/
web/src/shared/api/generated/

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store

# SQLite
*.db
*.db-shm
*.db-wal
```

- [ ] **Step 2: Write the OpenAPI spec**

Create `api/openapi.yaml`. This is the full API contract. Key design points:
- Discriminated unions use `oneOf` + `discriminator`
- Polymorphic GET `/events/{id}` returns different shapes based on token role
- PATCH `/events/{id}` only accepts mutable fields

```yaml
openapi: '3.1.0'
info:
  title: Availability API
  version: 0.1.0
  description: When2meet-style availability polling

servers:
  - url: http://localhost:8080
    description: Local development

paths:
  /events:
    post:
      operationId: createEvent
      summary: Create a new event
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateEventRequest'
      responses:
        '201':
          description: Event created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CreateEventResponse'

  /events/{eventId}:
    parameters:
      - name: eventId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      operationId: getEvent
      summary: Get event (polymorphic on auth role)
      security:
        - bearerAuth: []
        - {}
      responses:
        '200':
          description: Event data
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EventView'
        '404':
          description: Event not found
    patch:
      operationId: updateEvent
      summary: Update mutable event settings (host only)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateEventRequest'
      responses:
        '200':
          description: Event updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EventView'
        '403':
          description: Not the host
        '422':
          description: Attempted to modify immutable field

  /events/{eventId}/me:
    parameters:
      - name: eventId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      operationId: joinEvent
      summary: Join an event as a participant
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/JoinEventRequest'
      responses:
        '201':
          description: Joined
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/JoinEventResponse'
    get:
      operationId: getMyParticipation
      summary: Get own participation state
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Participation data
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MyParticipation'
        '401':
          description: No valid participant token
    patch:
      operationId: updateMyParticipation
      summary: Update own name/note
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateParticipationRequest'
      responses:
        '200':
          description: Updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MyParticipation'

  /events/{eventId}/me/availability:
    parameters:
      - name: eventId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    put:
      operationId: replaceAvailability
      summary: Replace full availability set
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ReplaceAvailabilityRequest'
      responses:
        '200':
          description: Availability replaced
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MyParticipation'

  /events/{eventId}/dates:
    parameters:
      - name: eventId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      operationId: suggestDate
      summary: Suggest a date (if suggestion policy is open)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SuggestDateRequest'
      responses:
        '201':
          description: Date suggested
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EventDate'
        '409':
          description: Date already exists (returns existing)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EventDate'
        '403':
          description: Suggestion policy is closed

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer

  schemas:
    VisibilityPolicy:
      oneOf:
        - $ref: '#/components/schemas/NamesVisibleVisibility'
        - $ref: '#/components/schemas/AnonymousVisibility'
      discriminator:
        propertyName: kind
        mapping:
          names-visible: '#/components/schemas/NamesVisibleVisibility'
          anonymous: '#/components/schemas/AnonymousVisibility'

    NamesVisibleVisibility:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          const: names-visible

    AnonymousVisibility:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          const: anonymous

    SuggestionPolicy:
      oneOf:
        - $ref: '#/components/schemas/OpenSuggestionPolicy'
        - $ref: '#/components/schemas/ClosedSuggestionPolicy'
      discriminator:
        propertyName: kind
        mapping:
          open: '#/components/schemas/OpenSuggestionPolicy'
          closed: '#/components/schemas/ClosedSuggestionPolicy'

    OpenSuggestionPolicy:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          const: open

    ClosedSuggestionPolicy:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          const: closed

    SlotDuration:
      type: integer
      enum: [15, 30, 60]

    TimeSlotConfig:
      type: object
      required: [durationMinutes, rangeStart, rangeEnd]
      properties:
        durationMinutes:
          $ref: '#/components/schemas/SlotDuration'
        rangeStart:
          type: string
          pattern: '^\d{2}:\d{2}$'
          description: 'HH:mm in host timezone'
        rangeEnd:
          type: string
          pattern: '^\d{2}:\d{2}$'
          description: 'HH:mm in host timezone'

    EventDate:
      oneOf:
        - $ref: '#/components/schemas/HostSuggestedDate'
        - $ref: '#/components/schemas/ParticipantSuggestedDate'
      discriminator:
        propertyName: origin
        mapping:
          host: '#/components/schemas/HostSuggestedDate'
          participant: '#/components/schemas/ParticipantSuggestedDate'

    HostSuggestedDate:
      type: object
      required: [id, date, origin]
      properties:
        id:
          type: string
          format: uuid
        date:
          type: string
          format: date
        origin:
          type: string
          const: host

    ParticipantSuggestedDate:
      type: object
      required: [id, date, origin, participantId]
      properties:
        id:
          type: string
          format: uuid
        date:
          type: string
          format: date
        origin:
          type: string
          const: participant
        participantId:
          type: string
          format: uuid

    AvailabilityEntry:
      oneOf:
        - $ref: '#/components/schemas/AvailableEntry'
        - $ref: '#/components/schemas/IfNeededEntry'
      discriminator:
        propertyName: kind
        mapping:
          available: '#/components/schemas/AvailableEntry'
          if-needed: '#/components/schemas/IfNeededEntry'

    AvailableEntry:
      type: object
      required: [kind, eventDateId, slot]
      properties:
        kind:
          type: string
          const: available
        eventDateId:
          type: string
          format: uuid
        slot:
          type: string
          description: 'Full ISO datetime in host timezone, e.g. 2026-07-15T22:00'

    IfNeededEntry:
      type: object
      required: [kind, eventDateId, slot]
      properties:
        kind:
          type: string
          const: if-needed
        eventDateId:
          type: string
          format: uuid
        slot:
          type: string
          description: 'Full ISO datetime in host timezone'
        reason:
          type: string

    Participant:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        note:
          type: string

    ParticipantWithAvailability:
      type: object
      required: [id, name, availability]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        note:
          type: string
        availability:
          type: array
          items:
            $ref: '#/components/schemas/AvailabilityEntry'

    EventBase:
      type: object
      required: [id, title, timezone, timeSlotConfig, dates]
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        description:
          type: string
        timezone:
          type: string
          description: IANA timezone
        timeSlotConfig:
          $ref: '#/components/schemas/TimeSlotConfig'
        dates:
          type: array
          items:
            $ref: '#/components/schemas/EventDate'

    PublicEventView:
      allOf:
        - $ref: '#/components/schemas/EventBase'
        - type: object
          required: [role]
          properties:
            role:
              type: string
              const: public

    ParticipantEventView:
      allOf:
        - $ref: '#/components/schemas/EventBase'
        - type: object
          required: [role, visibility, suggestions, participants]
          properties:
            role:
              type: string
              const: participant
            visibility:
              $ref: '#/components/schemas/VisibilityPolicy'
            suggestions:
              $ref: '#/components/schemas/SuggestionPolicy'
            participants:
              type: array
              items:
                $ref: '#/components/schemas/ParticipantWithAvailability'

    HostEventView:
      allOf:
        - $ref: '#/components/schemas/EventBase'
        - type: object
          required: [role, visibility, suggestions, participants]
          properties:
            role:
              type: string
              const: host
            visibility:
              $ref: '#/components/schemas/VisibilityPolicy'
            suggestions:
              $ref: '#/components/schemas/SuggestionPolicy'
            participants:
              type: array
              items:
                $ref: '#/components/schemas/ParticipantWithAvailability'

    EventView:
      oneOf:
        - $ref: '#/components/schemas/PublicEventView'
        - $ref: '#/components/schemas/ParticipantEventView'
        - $ref: '#/components/schemas/HostEventView'
      discriminator:
        propertyName: role
        mapping:
          public: '#/components/schemas/PublicEventView'
          participant: '#/components/schemas/ParticipantEventView'
          host: '#/components/schemas/HostEventView'

    CreateEventRequest:
      type: object
      required: [title, timezone, timeSlotConfig, visibility, suggestions, dates]
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
        description:
          type: string
          maxLength: 2000
        timezone:
          type: string
          description: IANA timezone
        timeSlotConfig:
          $ref: '#/components/schemas/TimeSlotConfig'
        visibility:
          $ref: '#/components/schemas/VisibilityPolicy'
        suggestions:
          $ref: '#/components/schemas/SuggestionPolicy'
        dates:
          type: array
          items:
            type: string
            format: date
          minItems: 1

    CreateEventResponse:
      type: object
      required: [eventId, hostToken]
      properties:
        eventId:
          type: string
          format: uuid
        hostToken:
          type: string

    UpdateEventRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
        description:
          type: string
          maxLength: 2000
        visibility:
          $ref: '#/components/schemas/VisibilityPolicy'
        suggestions:
          $ref: '#/components/schemas/SuggestionPolicy'

    JoinEventRequest:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 100

    JoinEventResponse:
      type: object
      required: [participantId, token]
      properties:
        participantId:
          type: string
          format: uuid
        token:
          type: string

    UpdateParticipationRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 100
        note:
          type: string
          maxLength: 2000

    MyParticipation:
      type: object
      required: [id, name, availability]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        note:
          type: string
        availability:
          type: array
          items:
            $ref: '#/components/schemas/AvailabilityEntry'

    ReplaceAvailabilityRequest:
      type: object
      required: [entries]
      properties:
        entries:
          type: array
          items:
            $ref: '#/components/schemas/AvailabilityEntry'

    SuggestDateRequest:
      type: object
      required: [date]
      properties:
        date:
          type: string
          format: date
```

- [ ] **Step 3: Set up oapi-codegen config**

Create `api/oapi-codegen.yaml`:

```yaml
package: generated
generate:
  chi-server: true
  models: true
  embedded-spec: true
output: ../server/internal/generated/api.gen.go
```

- [ ] **Step 4: Set up openapi-typescript config**

Create `api/package.json`:

```json
{
  "name": "@availability/api",
  "private": true,
  "scripts": {
    "generate": "openapi-typescript openapi.yaml -o ../web/src/shared/api/generated/schema.d.ts"
  },
  "devDependencies": {
    "openapi-typescript": "^7.0.0"
  }
}
```

- [ ] **Step 5: Create Makefile with codegen targets**

```makefile
.PHONY: generate generate-go generate-ts

generate: generate-go generate-ts

generate-go:
	cd api && oapi-codegen -config oapi-codegen.yaml openapi.yaml

generate-ts:
	cd api && pnpm run generate
```

- [ ] **Step 6: Run codegen and verify output**

```bash
cd api && pnpm install
make generate
```

Expected: `server/internal/generated/api.gen.go` exists with Go types + chi server interface. `web/src/shared/api/generated/schema.d.ts` exists with TypeScript types.

- [ ] **Step 7: Commit**

```bash
git add api/ Makefile .gitignore
git add server/internal/generated/api.gen.go
git add web/src/shared/api/generated/schema.d.ts
git commit -m "feat: add OpenAPI spec and codegen pipeline"
```

---

### Task 2: Go Domain Types + Database Foundation

**Files:**
- Create: `server/go.mod`
- Create: `server/internal/domain/event.go`
- Create: `server/internal/domain/participant.go`
- Create: `server/internal/domain/availability.go`
- Create: `server/internal/domain/eventdate.go`
- Create: `server/internal/domain/ids.go`
- Create: `server/internal/db/db.go`
- Create: `server/internal/db/migrations.go`
- Create: `server/internal/db/db_test.go`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: `domain.*` types (used by all server tasks), `db.New()` function (returns `*sql.DB` with PRAGMAs set), `db.Migrate()` (creates all tables, triggers, indexes)

- [ ] **Step 1: Initialize Go module**

```bash
cd server && go mod init github.com/pennane/availability/server
go get modernc.org/sqlite
go get github.com/google/uuid
```

- [ ] **Step 2: Write domain types — `server/internal/domain/event.go`**

```go
package domain

import "time"

type VisibilityPolicy interface {
	visibilityPolicy()
}

type NamesVisibleVisibility struct{}
type AnonymousVisibility struct{}

func (NamesVisibleVisibility) visibilityPolicy() {}
func (AnonymousVisibility) visibilityPolicy()    {}

type SuggestionPolicy interface {
	suggestionPolicy()
}

type OpenSuggestionPolicy struct{}
type ClosedSuggestionPolicy struct{}

func (OpenSuggestionPolicy) suggestionPolicy()  {}
func (ClosedSuggestionPolicy) suggestionPolicy() {}

type TimeSlotConfig struct {
	DurationMinutes int
	RangeStart      string // HH:mm
	RangeEnd        string // HH:mm
}

type Event struct {
	ID             string
	Title          string
	Description    string
	HostToken      string
	Timezone       string
	TimeSlotConfig TimeSlotConfig
	Visibility     VisibilityPolicy
	Suggestions    SuggestionPolicy
	Dates          []EventDate
	CreatedAt      time.Time
}
```

- [ ] **Step 3: Write domain types — `server/internal/domain/eventdate.go`**

```go
package domain

type EventDateOrigin interface {
	eventDateOrigin()
}

type HostSuggestedOrigin struct{}
type ParticipantSuggestedOrigin struct {
	ParticipantID string
}

func (HostSuggestedOrigin) eventDateOrigin()        {}
func (ParticipantSuggestedOrigin) eventDateOrigin() {}

type EventDate struct {
	ID      string
	EventID string
	Date    string // YYYY-MM-DD
	Origin  EventDateOrigin
}
```

- [ ] **Step 4: Write domain types — `server/internal/domain/participant.go`**

```go
package domain

type Participant struct {
	ID      string
	EventID string
	Name    string
	Token   string
	Note    string
}
```

- [ ] **Step 5: Write domain types — `server/internal/domain/availability.go`**

```go
package domain

type AvailabilityKind interface {
	availabilityKind()
}

type AvailableKind struct{}
type IfNeededKind struct {
	Reason string
}

func (AvailableKind) availabilityKind() {}
func (IfNeededKind) availabilityKind()  {}

type AvailabilityEntry struct {
	ID          string
	EventDateID string
	Slot        string // full ISO datetime, e.g. 2026-07-15T22:00
	Kind        AvailabilityKind
}
```

- [ ] **Step 6: Write ID/token generation — `server/internal/domain/ids.go`**

```go
package domain

import (
	"crypto/rand"
	"encoding/base64"

	"github.com/google/uuid"
)

func NewID() string {
	return uuid.Must(uuid.NewV7()).String()
}

func NewToken() string {
	b := make([]byte, 16) // 128 bits
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
```

- [ ] **Step 7: Write database setup — `server/internal/db/db.go`**

```go
package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

func New(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}
```

- [ ] **Step 8: Write migrations — `server/internal/db/migrations.go`**

```go
package db

import "database/sql"

func Migrate(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS events (
	id                    TEXT PRIMARY KEY,
	title                 TEXT NOT NULL,
	host_token            TEXT NOT NULL UNIQUE,
	description           TEXT DEFAULT '',
	timezone              TEXT NOT NULL,
	slot_duration_minutes INTEGER NOT NULL CHECK(slot_duration_minutes IN (15, 30, 60)),
	time_range_start      TEXT NOT NULL,
	time_range_end        TEXT NOT NULL,
	created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS names_visible_visibility (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS anonymous_visibility (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_names_visible_excl
BEFORE INSERT ON names_visible_visibility
BEGIN
	SELECT RAISE(ABORT, 'event already has anonymous visibility')
	WHERE EXISTS (SELECT 1 FROM anonymous_visibility WHERE event_id = NEW.event_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_excl
BEFORE INSERT ON anonymous_visibility
BEGIN
	SELECT RAISE(ABORT, 'event already has names-visible visibility')
	WHERE EXISTS (SELECT 1 FROM names_visible_visibility WHERE event_id = NEW.event_id);
END;

CREATE TABLE IF NOT EXISTS open_suggestion_policy (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS closed_suggestion_policy (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_open_suggestion_excl
BEFORE INSERT ON open_suggestion_policy
BEGIN
	SELECT RAISE(ABORT, 'event already has closed suggestion policy')
	WHERE EXISTS (SELECT 1 FROM closed_suggestion_policy WHERE event_id = NEW.event_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_closed_suggestion_excl
BEFORE INSERT ON closed_suggestion_policy
BEGIN
	SELECT RAISE(ABORT, 'event already has open suggestion policy')
	WHERE EXISTS (SELECT 1 FROM open_suggestion_policy WHERE event_id = NEW.event_id);
END;

CREATE TABLE IF NOT EXISTS participants (
	id       TEXT PRIMARY KEY,
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	name     TEXT NOT NULL,
	token    TEXT NOT NULL UNIQUE,
	note     TEXT DEFAULT '',
	UNIQUE(id, event_id)
);

CREATE TABLE IF NOT EXISTS event_dates (
	id       TEXT PRIMARY KEY,
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	date     TEXT NOT NULL,
	UNIQUE(event_id, date),
	UNIQUE(id, event_id)
);

CREATE TABLE IF NOT EXISTS host_suggested_dates (
	event_date_id TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participant_suggested_dates (
	event_date_id  TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE,
	participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_host_date_excl
BEFORE INSERT ON host_suggested_dates
BEGIN
	SELECT RAISE(ABORT, 'date already suggested by participant')
	WHERE EXISTS (SELECT 1 FROM participant_suggested_dates WHERE event_date_id = NEW.event_date_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_participant_date_excl
BEFORE INSERT ON participant_suggested_dates
BEGIN
	SELECT RAISE(ABORT, 'date already suggested by host')
	WHERE EXISTS (SELECT 1 FROM host_suggested_dates WHERE event_date_id = NEW.event_date_id);
END;

CREATE TABLE IF NOT EXISTS availability (
	id             TEXT PRIMARY KEY,
	participant_id TEXT NOT NULL,
	event_date_id  TEXT NOT NULL,
	event_id       TEXT NOT NULL,
	slot           TEXT NOT NULL,
	UNIQUE(participant_id, event_date_id, slot),
	FOREIGN KEY (participant_id, event_id) REFERENCES participants(id, event_id),
	FOREIGN KEY (event_date_id, event_id) REFERENCES event_dates(id, event_id)
);

CREATE TABLE IF NOT EXISTS available_availability (
	availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS if_needed_availability (
	availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE,
	reason          TEXT DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS trg_available_excl
BEFORE INSERT ON available_availability
BEGIN
	SELECT RAISE(ABORT, 'availability already marked as if-needed')
	WHERE EXISTS (SELECT 1 FROM if_needed_availability WHERE availability_id = NEW.availability_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_if_needed_excl
BEFORE INSERT ON if_needed_availability
BEGIN
	SELECT RAISE(ABORT, 'availability already marked as available')
	WHERE EXISTS (SELECT 1 FROM available_availability WHERE availability_id = NEW.availability_id);
END;

CREATE INDEX IF NOT EXISTS idx_availability_event_date_id ON availability(event_date_id);
CREATE INDEX IF NOT EXISTS idx_availability_event_id ON availability(event_id);
CREATE INDEX IF NOT EXISTS idx_event_dates_event_id ON event_dates(event_id);
CREATE INDEX IF NOT EXISTS idx_participants_event_id ON participants(event_id);
`

```

- [ ] **Step 9: Write the failing test — `server/internal/db/db_test.go`**

```go
package db_test

import (
	"testing"

	"github.com/pennane/availability/server/internal/db"
)

func TestMigrate(t *testing.T) {
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatalf("failed to create db: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	// Verify tables exist
	tables := []string{
		"events", "names_visible_visibility", "anonymous_visibility",
		"open_suggestion_policy", "closed_suggestion_policy",
		"participants", "event_dates", "host_suggested_dates",
		"participant_suggested_dates", "availability",
		"available_availability", "if_needed_availability",
	}
	for _, table := range tables {
		var name string
		err := database.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %s not found: %v", table, err)
		}
	}
}

func TestVisibilityTriggerExclusivity(t *testing.T) {
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	db.Migrate(database)

	database.Exec(`INSERT INTO events (id, title, host_token, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES ('evt1', 'Test', 'tok1', 'Europe/Helsinki', 30, '09:00', '17:00', '2026-01-01T00:00:00Z')`)
	database.Exec(`INSERT INTO names_visible_visibility (event_id) VALUES ('evt1')`)

	_, err = database.Exec(`INSERT INTO anonymous_visibility (event_id) VALUES ('evt1')`)
	if err == nil {
		t.Fatal("expected trigger to reject duplicate visibility variant")
	}
}

func TestAvailabilityTriggerExclusivity(t *testing.T) {
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	db.Migrate(database)

	database.Exec(`INSERT INTO events (id, title, host_token, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES ('evt1', 'Test', 'tok1', 'Europe/Helsinki', 30, '09:00', '17:00', '2026-01-01T00:00:00Z')`)
	database.Exec(`INSERT INTO names_visible_visibility (event_id) VALUES ('evt1')`)
	database.Exec(`INSERT INTO open_suggestion_policy (event_id) VALUES ('evt1')`)
	database.Exec(`INSERT INTO participants (id, event_id, name, token) VALUES ('p1', 'evt1', 'Alice', 'ptok1')`)
	database.Exec(`INSERT INTO event_dates (id, event_id, date) VALUES ('d1', 'evt1', '2026-07-15')`)
	database.Exec(`INSERT INTO host_suggested_dates (event_date_id) VALUES ('d1')`)
	database.Exec(`INSERT INTO availability (id, participant_id, event_date_id, event_id, slot) VALUES ('a1', 'p1', 'd1', 'evt1', '2026-07-15T09:00')`)
	database.Exec(`INSERT INTO available_availability (availability_id) VALUES ('a1')`)

	_, err = database.Exec(`INSERT INTO if_needed_availability (availability_id) VALUES ('a1')`)
	if err == nil {
		t.Fatal("expected trigger to reject duplicate availability variant")
	}
}

func TestCompositeFKPreventssCrossEvent(t *testing.T) {
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	db.Migrate(database)

	// Create two events
	database.Exec(`INSERT INTO events (id, title, host_token, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES ('evt1', 'Event 1', 'tok1', 'Europe/Helsinki', 30, '09:00', '17:00', '2026-01-01T00:00:00Z')`)
	database.Exec(`INSERT INTO events (id, title, host_token, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES ('evt2', 'Event 2', 'tok2', 'Europe/Helsinki', 30, '09:00', '17:00', '2026-01-01T00:00:00Z')`)
	database.Exec(`INSERT INTO names_visible_visibility (event_id) VALUES ('evt1')`)
	database.Exec(`INSERT INTO names_visible_visibility (event_id) VALUES ('evt2')`)
	database.Exec(`INSERT INTO open_suggestion_policy (event_id) VALUES ('evt1')`)
	database.Exec(`INSERT INTO open_suggestion_policy (event_id) VALUES ('evt2')`)

	// Participant in event 1, date in event 2
	database.Exec(`INSERT INTO participants (id, event_id, name, token) VALUES ('p1', 'evt1', 'Alice', 'ptok1')`)
	database.Exec(`INSERT INTO event_dates (id, event_id, date) VALUES ('d2', 'evt2', '2026-07-15')`)
	database.Exec(`INSERT INTO host_suggested_dates (event_date_id) VALUES ('d2')`)

	// Try to link participant from evt1 to date from evt2
	_, err = database.Exec(`INSERT INTO availability (id, participant_id, event_date_id, event_id, slot)
		VALUES ('a1', 'p1', 'd2', 'evt1', '2026-07-15T09:00')`)
	if err == nil {
		t.Fatal("expected composite FK to reject cross-event availability")
	}
}
```

- [ ] **Step 10: Run tests**

```bash
cd server && go test ./internal/db/ -v
```

Expected: all 4 tests pass.

- [ ] **Step 11: Commit**

```bash
git add server/
git commit -m "feat: add Go domain types and database foundation with triggers"
```

---

### Task 3: Event Repository + Service

**Files:**
- Create: `server/internal/repository/event_repo.go`
- Create: `server/internal/repository/event_repo_test.go`
- Create: `server/internal/service/event_service.go`
- Create: `server/internal/service/event_service_test.go`

**Interfaces:**
- Consumes: `domain.*` types, `db.New()`, `db.Migrate()`
- Produces: `EventRepository` interface, `SQLiteEventRepo` impl, `EventService` struct

- [ ] **Step 1: Write the event repository interface and implementation — `server/internal/repository/event_repo.go`**

```go
package repository

import (
	"database/sql"
	"fmt"

	"github.com/pennane/availability/server/internal/domain"
)

type EventRepository interface {
	Create(event domain.Event) error
	GetByID(id string) (*domain.Event, error)
	GetByHostToken(token string) (*domain.Event, error)
	UpdateMutable(id string, title *string, description *string, visibility domain.VisibilityPolicy, suggestions domain.SuggestionPolicy) error
}

type SQLiteEventRepo struct {
	db *sql.DB
}

func NewSQLiteEventRepo(db *sql.DB) *SQLiteEventRepo {
	return &SQLiteEventRepo{db: db}
}

func (r *SQLiteEventRepo) Create(event domain.Event) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`INSERT INTO events (id, title, host_token, description, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.ID, event.Title, event.HostToken, event.Description, event.Timezone,
		event.TimeSlotConfig.DurationMinutes, event.TimeSlotConfig.RangeStart, event.TimeSlotConfig.RangeEnd,
		event.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	)
	if err != nil {
		return err
	}

	if err := insertVisibility(tx, event.ID, event.Visibility); err != nil {
		return err
	}
	if err := insertSuggestionPolicy(tx, event.ID, event.Suggestions); err != nil {
		return err
	}

	for _, d := range event.Dates {
		_, err := tx.Exec(`INSERT INTO event_dates (id, event_id, date) VALUES (?, ?, ?)`, d.ID, event.ID, d.Date)
		if err != nil {
			return err
		}
		if err := insertDateOrigin(tx, d); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *SQLiteEventRepo) GetByID(id string) (*domain.Event, error) {
	return r.getEvent("SELECT id, title, host_token, description, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at FROM events WHERE id = ?", id)
}

func (r *SQLiteEventRepo) GetByHostToken(token string) (*domain.Event, error) {
	return r.getEvent("SELECT id, title, host_token, description, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at FROM events WHERE host_token = ?", token)
}

func (r *SQLiteEventRepo) getEvent(query string, arg string) (*domain.Event, error) {
	var e domain.Event
	var createdAt string
	err := r.db.QueryRow(query, arg).Scan(
		&e.ID, &e.Title, &e.HostToken, &e.Description, &e.Timezone,
		&e.TimeSlotConfig.DurationMinutes, &e.TimeSlotConfig.RangeStart, &e.TimeSlotConfig.RangeEnd,
		&createdAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	e.CreatedAt, _ = parseUTC(createdAt)

	visibility, err := r.getVisibility(e.ID)
	if err != nil {
		return nil, err
	}
	e.Visibility = visibility

	suggestions, err := r.getSuggestionPolicy(e.ID)
	if err != nil {
		return nil, err
	}
	e.Suggestions = suggestions

	return &e, nil
}

func (r *SQLiteEventRepo) UpdateMutable(id string, title *string, description *string, visibility domain.VisibilityPolicy, suggestions domain.SuggestionPolicy) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if title != nil {
		if _, err := tx.Exec("UPDATE events SET title = ? WHERE id = ?", *title, id); err != nil {
			return err
		}
	}
	if description != nil {
		if _, err := tx.Exec("UPDATE events SET description = ? WHERE id = ?", *description, id); err != nil {
			return err
		}
	}
	if visibility != nil {
		tx.Exec("DELETE FROM names_visible_visibility WHERE event_id = ?", id)
		tx.Exec("DELETE FROM anonymous_visibility WHERE event_id = ?", id)
		if err := insertVisibility(tx, id, visibility); err != nil {
			return err
		}
	}
	if suggestions != nil {
		tx.Exec("DELETE FROM open_suggestion_policy WHERE event_id = ?", id)
		tx.Exec("DELETE FROM closed_suggestion_policy WHERE event_id = ?", id)
		if err := insertSuggestionPolicy(tx, id, suggestions); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *SQLiteEventRepo) getVisibility(eventID string) (domain.VisibilityPolicy, error) {
	var id string
	err := r.db.QueryRow("SELECT event_id FROM names_visible_visibility WHERE event_id = ?", eventID).Scan(&id)
	if err == nil {
		return domain.NamesVisibleVisibility{}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	err = r.db.QueryRow("SELECT event_id FROM anonymous_visibility WHERE event_id = ?", eventID).Scan(&id)
	if err == nil {
		return domain.AnonymousVisibility{}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	return nil, fmt.Errorf("no visibility policy for event %s", eventID)
}

func (r *SQLiteEventRepo) getSuggestionPolicy(eventID string) (domain.SuggestionPolicy, error) {
	var id string
	err := r.db.QueryRow("SELECT event_id FROM open_suggestion_policy WHERE event_id = ?", eventID).Scan(&id)
	if err == nil {
		return domain.OpenSuggestionPolicy{}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	err = r.db.QueryRow("SELECT event_id FROM closed_suggestion_policy WHERE event_id = ?", eventID).Scan(&id)
	if err == nil {
		return domain.ClosedSuggestionPolicy{}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	return nil, fmt.Errorf("no suggestion policy for event %s", eventID)
}

func insertVisibility(tx *sql.Tx, eventID string, v domain.VisibilityPolicy) error {
	switch v.(type) {
	case domain.NamesVisibleVisibility:
		_, err := tx.Exec("INSERT INTO names_visible_visibility (event_id) VALUES (?)", eventID)
		return err
	case domain.AnonymousVisibility:
		_, err := tx.Exec("INSERT INTO anonymous_visibility (event_id) VALUES (?)", eventID)
		return err
	default:
		return fmt.Errorf("unknown visibility policy type: %T", v)
	}
}

func insertSuggestionPolicy(tx *sql.Tx, eventID string, s domain.SuggestionPolicy) error {
	switch s.(type) {
	case domain.OpenSuggestionPolicy:
		_, err := tx.Exec("INSERT INTO open_suggestion_policy (event_id) VALUES (?)", eventID)
		return err
	case domain.ClosedSuggestionPolicy:
		_, err := tx.Exec("INSERT INTO closed_suggestion_policy (event_id) VALUES (?)", eventID)
		return err
	default:
		return fmt.Errorf("unknown suggestion policy type: %T", s)
	}
}

func insertDateOrigin(tx *sql.Tx, d domain.EventDate) error {
	switch d.Origin.(type) {
	case domain.HostSuggestedOrigin:
		_, err := tx.Exec("INSERT INTO host_suggested_dates (event_date_id) VALUES (?)", d.ID)
		return err
	case domain.ParticipantSuggestedOrigin:
		o := d.Origin.(domain.ParticipantSuggestedOrigin)
		_, err := tx.Exec("INSERT INTO participant_suggested_dates (event_date_id, participant_id) VALUES (?, ?)", d.ID, o.ParticipantID)
		return err
	default:
		return fmt.Errorf("unknown date origin type: %T", d.Origin)
	}
}

func parseUTC(s string) (t time.Time, err error) {
	return time.Parse("2006-01-02T15:04:05Z", s)
}
```

Note: add `"time"` to imports.

- [ ] **Step 2: Write the failing test — `server/internal/repository/event_repo_test.go`**

```go
package repository_test

import (
	"testing"
	"time"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestCreateAndGetEvent(t *testing.T) {
	database := setupTestDB(t)
	repo := repository.NewSQLiteEventRepo(database)

	event := domain.Event{
		ID:          domain.NewID(),
		Title:       "Team Standup",
		Description: "Weekly sync",
		HostToken:   domain.NewToken(),
		Timezone:    "Europe/Helsinki",
		TimeSlotConfig: domain.TimeSlotConfig{
			DurationMinutes: 30,
			RangeStart:      "09:00",
			RangeEnd:        "17:00",
		},
		Visibility:  domain.NamesVisibleVisibility{},
		Suggestions: domain.OpenSuggestionPolicy{},
		Dates: []domain.EventDate{
			{ID: domain.NewID(), Date: "2026-07-15", Origin: domain.HostSuggestedOrigin{}},
			{ID: domain.NewID(), Date: "2026-07-16", Origin: domain.HostSuggestedOrigin{}},
		},
		CreatedAt: time.Now(),
	}

	if err := repo.Create(event); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := repo.GetByID(event.ID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected event, got nil")
	}
	if got.Title != "Team Standup" {
		t.Errorf("title = %q, want %q", got.Title, "Team Standup")
	}

	switch got.Visibility.(type) {
	case domain.NamesVisibleVisibility:
		// ok
	default:
		t.Errorf("visibility = %T, want NamesVisibleVisibility", got.Visibility)
	}

	switch got.Suggestions.(type) {
	case domain.OpenSuggestionPolicy:
		// ok
	default:
		t.Errorf("suggestions = %T, want OpenSuggestionPolicy", got.Suggestions)
	}
}

func TestUpdateVisibilitySwap(t *testing.T) {
	database := setupTestDB(t)
	repo := repository.NewSQLiteEventRepo(database)

	event := domain.Event{
		ID:          domain.NewID(),
		Title:       "Test",
		HostToken:   domain.NewToken(),
		Timezone:    "Europe/Helsinki",
		TimeSlotConfig: domain.TimeSlotConfig{
			DurationMinutes: 30,
			RangeStart:      "09:00",
			RangeEnd:        "17:00",
		},
		Visibility:  domain.NamesVisibleVisibility{},
		Suggestions: domain.OpenSuggestionPolicy{},
		CreatedAt:   time.Now(),
	}
	repo.Create(event)

	newVis := domain.AnonymousVisibility{}
	err := repo.UpdateMutable(event.ID, nil, nil, newVis, nil)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}

	got, _ := repo.GetByID(event.ID)
	switch got.Visibility.(type) {
	case domain.AnonymousVisibility:
		// ok
	default:
		t.Errorf("visibility = %T, want AnonymousVisibility", got.Visibility)
	}
}

func TestGetByHostToken(t *testing.T) {
	database := setupTestDB(t)
	repo := repository.NewSQLiteEventRepo(database)

	token := domain.NewToken()
	event := domain.Event{
		ID:          domain.NewID(),
		Title:       "Test",
		HostToken:   token,
		Timezone:    "UTC",
		TimeSlotConfig: domain.TimeSlotConfig{
			DurationMinutes: 15,
			RangeStart:      "10:00",
			RangeEnd:        "12:00",
		},
		Visibility:  domain.AnonymousVisibility{},
		Suggestions: domain.ClosedSuggestionPolicy{},
		CreatedAt:   time.Now(),
	}
	repo.Create(event)

	got, err := repo.GetByHostToken(token)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected event, got nil")
	}
	if got.ID != event.ID {
		t.Errorf("ID = %q, want %q", got.ID, event.ID)
	}
}
```

Note: add `"database/sql"` import to the `setupTestDB` function.

- [ ] **Step 3: Run tests**

```bash
cd server && go test ./internal/repository/ -v
```

Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/internal/repository/
git commit -m "feat: add event repository with variant swap support"
```

---

### Task 4: Participant + Event Date + Availability Repositories

**Files:**
- Create: `server/internal/repository/participant_repo.go`
- Create: `server/internal/repository/eventdate_repo.go`
- Create: `server/internal/repository/availability_repo.go`
- Create: `server/internal/repository/repos_test.go`

**Interfaces:**
- Consumes: `domain.*` types, `db.New()`, `db.Migrate()`
- Produces: `ParticipantRepository`, `EventDateRepository`, `AvailabilityRepository` interfaces + SQLite impls

- [ ] **Step 1: Write participant repository — `server/internal/repository/participant_repo.go`**

```go
package repository

import (
	"database/sql"

	"github.com/pennane/availability/server/internal/domain"
)

type ParticipantRepository interface {
	Create(p domain.Participant) error
	GetByToken(token string) (*domain.Participant, error)
	GetByEventID(eventID string) ([]domain.Participant, error)
	Update(id string, name *string, note *string) error
}

type SQLiteParticipantRepo struct {
	db *sql.DB
}

func NewSQLiteParticipantRepo(db *sql.DB) *SQLiteParticipantRepo {
	return &SQLiteParticipantRepo{db: db}
}

func (r *SQLiteParticipantRepo) Create(p domain.Participant) error {
	_, err := r.db.Exec(
		`INSERT INTO participants (id, event_id, name, token, note) VALUES (?, ?, ?, ?, ?)`,
		p.ID, p.EventID, p.Name, p.Token, p.Note,
	)
	return err
}

func (r *SQLiteParticipantRepo) GetByToken(token string) (*domain.Participant, error) {
	var p domain.Participant
	err := r.db.QueryRow(
		`SELECT id, event_id, name, token, note FROM participants WHERE token = ?`, token,
	).Scan(&p.ID, &p.EventID, &p.Name, &p.Token, &p.Note)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *SQLiteParticipantRepo) GetByEventID(eventID string) ([]domain.Participant, error) {
	rows, err := r.db.Query(
		`SELECT id, event_id, name, token, note FROM participants WHERE event_id = ?`, eventID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var participants []domain.Participant
	for rows.Next() {
		var p domain.Participant
		if err := rows.Scan(&p.ID, &p.EventID, &p.Name, &p.Token, &p.Note); err != nil {
			return nil, err
		}
		participants = append(participants, p)
	}
	return participants, rows.Err()
}

func (r *SQLiteParticipantRepo) Update(id string, name *string, note *string) error {
	if name != nil {
		if _, err := r.db.Exec("UPDATE participants SET name = ? WHERE id = ?", *name, id); err != nil {
			return err
		}
	}
	if note != nil {
		if _, err := r.db.Exec("UPDATE participants SET note = ? WHERE id = ?", *note, id); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 2: Write event date repository — `server/internal/repository/eventdate_repo.go`**

```go
package repository

import (
	"database/sql"
	"fmt"

	"github.com/pennane/availability/server/internal/domain"
)

type EventDateRepository interface {
	Create(eventDate domain.EventDate) error
	GetByEventID(eventID string) ([]domain.EventDate, error)
	GetByEventIDAndDate(eventID string, date string) (*domain.EventDate, error)
}

type SQLiteEventDateRepo struct {
	db *sql.DB
}

func NewSQLiteEventDateRepo(db *sql.DB) *SQLiteEventDateRepo {
	return &SQLiteEventDateRepo{db: db}
}

func (r *SQLiteEventDateRepo) Create(ed domain.EventDate) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`INSERT INTO event_dates (id, event_id, date) VALUES (?, ?, ?)`, ed.ID, ed.EventID, ed.Date)
	if err != nil {
		return err
	}

	if err := insertDateOrigin(tx, ed); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *SQLiteEventDateRepo) GetByEventID(eventID string) ([]domain.EventDate, error) {
	rows, err := r.db.Query(`SELECT id, event_id, date FROM event_dates WHERE event_id = ?`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dates []domain.EventDate
	for rows.Next() {
		var ed domain.EventDate
		if err := rows.Scan(&ed.ID, &ed.EventID, &ed.Date); err != nil {
			return nil, err
		}
		origin, err := r.getOrigin(ed.ID)
		if err != nil {
			return nil, err
		}
		ed.Origin = origin
		dates = append(dates, ed)
	}
	return dates, rows.Err()
}

func (r *SQLiteEventDateRepo) GetByEventIDAndDate(eventID string, date string) (*domain.EventDate, error) {
	var ed domain.EventDate
	err := r.db.QueryRow(`SELECT id, event_id, date FROM event_dates WHERE event_id = ? AND date = ?`, eventID, date).
		Scan(&ed.ID, &ed.EventID, &ed.Date)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	origin, err := r.getOrigin(ed.ID)
	if err != nil {
		return nil, err
	}
	ed.Origin = origin
	return &ed, nil
}

func (r *SQLiteEventDateRepo) getOrigin(eventDateID string) (domain.EventDateOrigin, error) {
	var id string
	err := r.db.QueryRow("SELECT event_date_id FROM host_suggested_dates WHERE event_date_id = ?", eventDateID).Scan(&id)
	if err == nil {
		return domain.HostSuggestedOrigin{}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	var participantID string
	err = r.db.QueryRow("SELECT participant_id FROM participant_suggested_dates WHERE event_date_id = ?", eventDateID).Scan(&participantID)
	if err == nil {
		return domain.ParticipantSuggestedOrigin{ParticipantID: participantID}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	return nil, fmt.Errorf("no origin for event date %s", eventDateID)
}
```

- [ ] **Step 3: Write availability repository — `server/internal/repository/availability_repo.go`**

```go
package repository

import (
	"database/sql"

	"github.com/pennane/availability/server/internal/domain"
)

type AvailabilityRepository interface {
	ReplaceForParticipant(participantID string, eventID string, entries []domain.AvailabilityEntry) error
	GetByEventID(eventID string) (map[string][]domain.AvailabilityEntry, error)
	GetByParticipantID(participantID string) ([]domain.AvailabilityEntry, error)
}

type SQLiteAvailabilityRepo struct {
	db *sql.DB
}

func NewSQLiteAvailabilityRepo(db *sql.DB) *SQLiteAvailabilityRepo {
	return &SQLiteAvailabilityRepo{db: db}
}

func (r *SQLiteAvailabilityRepo) ReplaceForParticipant(participantID string, eventID string, entries []domain.AvailabilityEntry) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// CASCADE deletes variant rows automatically
	_, err = tx.Exec("DELETE FROM availability WHERE participant_id = ? AND event_id = ?", participantID, eventID)
	if err != nil {
		return err
	}

	for _, e := range entries {
		_, err := tx.Exec(
			`INSERT INTO availability (id, participant_id, event_date_id, event_id, slot) VALUES (?, ?, ?, ?, ?)`,
			e.ID, participantID, e.EventDateID, eventID, e.Slot,
		)
		if err != nil {
			return err
		}

		switch k := e.Kind.(type) {
		case domain.AvailableKind:
			_, err = tx.Exec("INSERT INTO available_availability (availability_id) VALUES (?)", e.ID)
		case domain.IfNeededKind:
			_, err = tx.Exec("INSERT INTO if_needed_availability (availability_id, reason) VALUES (?, ?)", e.ID, k.Reason)
		}
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *SQLiteAvailabilityRepo) GetByEventID(eventID string) (map[string][]domain.AvailabilityEntry, error) {
	rows, err := r.db.Query(`
		SELECT a.id, a.participant_id, a.event_date_id, a.slot,
			CASE WHEN aa.availability_id IS NOT NULL THEN 1 ELSE 0 END AS is_available,
			COALESCE(ina.reason, '') AS reason
		FROM availability a
		LEFT JOIN available_availability aa ON aa.availability_id = a.id
		LEFT JOIN if_needed_availability ina ON ina.availability_id = a.id
		WHERE a.event_id = ?`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]domain.AvailabilityEntry)
	for rows.Next() {
		var id, participantID, eventDateID, slot, reason string
		var isAvailable bool
		if err := rows.Scan(&id, &participantID, &eventDateID, &slot, &isAvailable, &reason); err != nil {
			return nil, err
		}
		var kind domain.AvailabilityKind
		if isAvailable {
			kind = domain.AvailableKind{}
		} else {
			kind = domain.IfNeededKind{Reason: reason}
		}
		entry := domain.AvailabilityEntry{ID: id, EventDateID: eventDateID, Slot: slot, Kind: kind}
		result[participantID] = append(result[participantID], entry)
	}
	return result, rows.Err()
}

func (r *SQLiteAvailabilityRepo) GetByParticipantID(participantID string) ([]domain.AvailabilityEntry, error) {
	rows, err := r.db.Query(`
		SELECT a.id, a.event_date_id, a.slot,
			CASE WHEN aa.availability_id IS NOT NULL THEN 1 ELSE 0 END AS is_available,
			COALESCE(ina.reason, '') AS reason
		FROM availability a
		LEFT JOIN available_availability aa ON aa.availability_id = a.id
		LEFT JOIN if_needed_availability ina ON ina.availability_id = a.id
		WHERE a.participant_id = ?`, participantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []domain.AvailabilityEntry
	for rows.Next() {
		var id, eventDateID, slot, reason string
		var isAvailable bool
		if err := rows.Scan(&id, &eventDateID, &slot, &isAvailable, &reason); err != nil {
			return nil, err
		}
		var kind domain.AvailabilityKind
		if isAvailable {
			kind = domain.AvailableKind{}
		} else {
			kind = domain.IfNeededKind{Reason: reason}
		}
		entries = append(entries, domain.AvailabilityEntry{ID: id, EventDateID: eventDateID, Slot: slot, Kind: kind})
	}
	return entries, rows.Err()
}
```

- [ ] **Step 4: Write integration tests — `server/internal/repository/repos_test.go`**

```go
package repository_test

import (
	"database/sql"
	"testing"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func seedEvent(t *testing.T, database *sql.DB) domain.Event {
	t.Helper()
	repo := repository.NewSQLiteEventRepo(database)
	event := domain.Event{
		ID:          domain.NewID(),
		Title:       "Test Event",
		HostToken:   domain.NewToken(),
		Timezone:    "Europe/Helsinki",
		TimeSlotConfig: domain.TimeSlotConfig{DurationMinutes: 30, RangeStart: "09:00", RangeEnd: "17:00"},
		Visibility:  domain.NamesVisibleVisibility{},
		Suggestions: domain.OpenSuggestionPolicy{},
		Dates: []domain.EventDate{
			{ID: domain.NewID(), EventID: "", Date: "2026-07-15", Origin: domain.HostSuggestedOrigin{}},
		},
		CreatedAt: time.Now(),
	}
	event.Dates[0].EventID = event.ID
	if err := repo.Create(event); err != nil {
		t.Fatal(err)
	}
	return event
}

func TestParticipantCRUD(t *testing.T) {
	database := setupTestDB(t)
	event := seedEvent(t, database)
	repo := repository.NewSQLiteParticipantRepo(database)

	p := domain.Participant{
		ID:      domain.NewID(),
		EventID: event.ID,
		Name:    "Alice",
		Token:   domain.NewToken(),
	}
	if err := repo.Create(p); err != nil {
		t.Fatal(err)
	}

	got, err := repo.GetByToken(p.Token)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Alice" {
		t.Errorf("name = %q, want Alice", got.Name)
	}

	newName := "Bob"
	repo.Update(p.ID, &newName, nil)
	got, _ = repo.GetByToken(p.Token)
	if got.Name != "Bob" {
		t.Errorf("name = %q, want Bob", got.Name)
	}

	all, _ := repo.GetByEventID(event.ID)
	if len(all) != 1 {
		t.Errorf("len = %d, want 1", len(all))
	}
}

func TestAvailabilityReplaceAndGet(t *testing.T) {
	database := setupTestDB(t)
	event := seedEvent(t, database)

	pRepo := repository.NewSQLiteParticipantRepo(database)
	p := domain.Participant{ID: domain.NewID(), EventID: event.ID, Name: "Alice", Token: domain.NewToken()}
	pRepo.Create(p)

	aRepo := repository.NewSQLiteAvailabilityRepo(database)
	dateID := event.Dates[0].ID

	entries := []domain.AvailabilityEntry{
		{ID: domain.NewID(), EventDateID: dateID, Slot: "2026-07-15T09:00", Kind: domain.AvailableKind{}},
		{ID: domain.NewID(), EventDateID: dateID, Slot: "2026-07-15T09:30", Kind: domain.IfNeededKind{Reason: "maybe"}},
	}
	if err := aRepo.ReplaceForParticipant(p.ID, event.ID, entries); err != nil {
		t.Fatal(err)
	}

	got, err := aRepo.GetByParticipantID(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}

	byEvent, err := aRepo.GetByEventID(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(byEvent[p.ID]) != 2 {
		t.Errorf("by event len = %d, want 2", len(byEvent[p.ID]))
	}

	// Replace with fewer entries
	newEntries := []domain.AvailabilityEntry{
		{ID: domain.NewID(), EventDateID: dateID, Slot: "2026-07-15T10:00", Kind: domain.AvailableKind{}},
	}
	aRepo.ReplaceForParticipant(p.ID, event.ID, newEntries)
	got, _ = aRepo.GetByParticipantID(p.ID)
	if len(got) != 1 {
		t.Errorf("after replace len = %d, want 1", len(got))
	}
}

func TestEventDateSuggest(t *testing.T) {
	database := setupTestDB(t)
	event := seedEvent(t, database)
	pRepo := repository.NewSQLiteParticipantRepo(database)
	p := domain.Participant{ID: domain.NewID(), EventID: event.ID, Name: "Alice", Token: domain.NewToken()}
	pRepo.Create(p)

	edRepo := repository.NewSQLiteEventDateRepo(database)
	newDate := domain.EventDate{
		ID:      domain.NewID(),
		EventID: event.ID,
		Date:    "2026-07-20",
		Origin:  domain.ParticipantSuggestedOrigin{ParticipantID: p.ID},
	}
	if err := edRepo.Create(newDate); err != nil {
		t.Fatal(err)
	}

	dates, _ := edRepo.GetByEventID(event.ID)
	if len(dates) != 2 {
		t.Errorf("len = %d, want 2", len(dates))
	}

	// Check duplicate prevention
	existing, _ := edRepo.GetByEventIDAndDate(event.ID, "2026-07-20")
	if existing == nil {
		t.Fatal("expected to find existing date")
	}
}
```

Note: add `"time"` import for `seedEvent`.

- [ ] **Step 5: Run tests**

```bash
cd server && go test ./internal/repository/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/
git commit -m "feat: add participant, event date, and availability repositories"
```

---

### Task 5: HTTP Handlers + Auth + WebSocket + main.go

**Files:**
- Create: `server/internal/handler/handler.go`
- Create: `server/internal/handler/auth.go`
- Create: `server/internal/ws/broadcast.go`
- Create: `server/cmd/server/main.go`
- Create: `server/internal/handler/handler_test.go`

**Interfaces:**
- Consumes: all repositories, `domain.*`, `generated.ServerInterface`, `db.*`
- Produces: running HTTP server on `PORT` with all routes, WebSocket endpoint, CORS

This is the integration task — it wires everything together. The handler implements oapi-codegen's `ServerInterface`, translating between HTTP/generated types and domain types. Auth middleware extracts the bearer token and resolves the caller's role (host, participant, or anonymous).

- [ ] **Step 1: Write auth middleware — `server/internal/handler/auth.go`**

```go
package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

type contextKey string

const (
	ctxRole        contextKey = "role"
	ctxParticipant contextKey = "participant"
	ctxEventID     contextKey = "eventID"
)

type Role string

const (
	RoleAnonymous   Role = "anonymous"
	RoleHost        Role = "host"
	RoleParticipant Role = "participant"
)

type AuthResolver struct {
	events       repository.EventRepository
	participants repository.ParticipantRepository
}

func NewAuthResolver(events repository.EventRepository, participants repository.ParticipantRepository) *AuthResolver {
	return &AuthResolver{events: events, participants: participants}
}

func (a *AuthResolver) Resolve(r *http.Request, eventID string) (Role, *domain.Participant) {
	token := extractBearerToken(r)
	if token == "" {
		return RoleAnonymous, nil
	}

	event, err := a.events.GetByID(eventID)
	if err != nil || event == nil {
		return RoleAnonymous, nil
	}

	if event.HostToken == token {
		return RoleHost, nil
	}

	participant, err := a.participants.GetByToken(token)
	if err != nil || participant == nil {
		return RoleAnonymous, nil
	}
	if participant.EventID != eventID {
		return RoleAnonymous, nil
	}

	return RoleParticipant, participant
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(auth, "Bearer ")
}

func withRole(ctx context.Context, role Role) context.Context {
	return context.WithValue(ctx, ctxRole, role)
}

func withParticipant(ctx context.Context, p *domain.Participant) context.Context {
	return context.WithValue(ctx, ctxParticipant, p)
}

func roleFromCtx(ctx context.Context) Role {
	r, _ := ctx.Value(ctxRole).(Role)
	return r
}

func participantFromCtx(ctx context.Context) *domain.Participant {
	p, _ := ctx.Value(ctxParticipant).(*domain.Participant)
	return p
}
```

- [ ] **Step 2: Write WebSocket broadcast — `server/internal/ws/broadcast.go`**

```go
package ws

import (
	"encoding/json"
	"sync"
)

type EventMessage struct {
	Kind          string `json:"kind"`
	ParticipantID string `json:"participantId,omitempty"`
	Name          string `json:"name,omitempty"`
	EventDateID   string `json:"eventDateId,omitempty"`
	Date          string `json:"date,omitempty"`
}

type Client struct {
	Send chan []byte
}

type Broadcast struct {
	mu      sync.RWMutex
	rooms   map[string]map[*Client]bool // eventID -> clients
}

func NewBroadcast() *Broadcast {
	return &Broadcast{rooms: make(map[string]map[*Client]bool)}
}

func (b *Broadcast) Subscribe(eventID string, client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.rooms[eventID] == nil {
		b.rooms[eventID] = make(map[*Client]bool)
	}
	b.rooms[eventID][client] = true
}

func (b *Broadcast) Unsubscribe(eventID string, client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.rooms[eventID] != nil {
		delete(b.rooms[eventID], client)
		if len(b.rooms[eventID]) == 0 {
			delete(b.rooms, eventID)
		}
	}
}

func (b *Broadcast) Send(eventID string, msg EventMessage, exclude *Client) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	b.mu.RLock()
	defer b.mu.RUnlock()
	for client := range b.rooms[eventID] {
		if client == exclude {
			continue
		}
		select {
		case client.Send <- data:
		default:
			// client buffer full, skip
		}
	}
}
```

- [ ] **Step 3: Write handler skeleton — `server/internal/handler/handler.go`**

This is the largest file. It implements oapi-codegen's ServerInterface. Due to plan length constraints, the key methods are shown — the implementing engineer fills in the remaining methods following the same pattern.

```go
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

type Handler struct {
	events       repository.EventRepository
	participants repository.ParticipantRepository
	dates        repository.EventDateRepository
	availability repository.AvailabilityRepository
	auth         *AuthResolver
	broadcast    *ws.Broadcast
}

func New(
	events repository.EventRepository,
	participants repository.ParticipantRepository,
	dates repository.EventDateRepository,
	availability repository.AvailabilityRepository,
	broadcast *ws.Broadcast,
) *Handler {
	return &Handler{
		events:       events,
		participants: participants,
		dates:        dates,
		availability: availability,
		auth:         NewAuthResolver(events, participants),
		broadcast:    broadcast,
	}
}

func (h *Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Timezone    string `json:"timezone"`
		TimeSlotConfig struct {
			DurationMinutes int    `json:"durationMinutes"`
			RangeStart      string `json:"rangeStart"`
			RangeEnd        string `json:"rangeEnd"`
		} `json:"timeSlotConfig"`
		Visibility  json.RawMessage `json:"visibility"`
		Suggestions json.RawMessage `json:"suggestions"`
		Dates       []string        `json:"dates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	visibility, err := parseVisibility(req.Visibility)
	if err != nil {
		http.Error(w, "invalid visibility", http.StatusBadRequest)
		return
	}

	suggestions, err := parseSuggestionPolicy(req.Suggestions)
	if err != nil {
		http.Error(w, "invalid suggestion policy", http.StatusBadRequest)
		return
	}

	event := domain.Event{
		ID:          domain.NewID(),
		Title:       req.Title,
		Description: req.Description,
		HostToken:   domain.NewToken(),
		Timezone:    req.Timezone,
		TimeSlotConfig: domain.TimeSlotConfig{
			DurationMinutes: req.TimeSlotConfig.DurationMinutes,
			RangeStart:      req.TimeSlotConfig.RangeStart,
			RangeEnd:        req.TimeSlotConfig.RangeEnd,
		},
		Visibility:  visibility,
		Suggestions: suggestions,
		CreatedAt:   time.Now(),
	}

	for _, d := range req.Dates {
		event.Dates = append(event.Dates, domain.EventDate{
			ID:      domain.NewID(),
			EventID: event.ID,
			Date:    d,
			Origin:  domain.HostSuggestedOrigin{},
		})
	}

	if err := h.events.Create(event); err != nil {
		http.Error(w, "failed to create event", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"eventId":   event.ID,
		"hostToken": event.HostToken,
	})
}

func (h *Handler) GetEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	event, err := h.events.GetByID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	role, participant := h.auth.Resolve(r, eventID)
	dates, _ := h.dates.GetByEventID(eventID)
	event.Dates = dates

	var response any
	switch role {
	case RoleHost:
		participants, _ := h.participants.GetByEventID(eventID)
		allAvail, _ := h.availability.GetByEventID(eventID)
		response = buildHostView(event, participants, allAvail)
	case RoleParticipant:
		participants, _ := h.participants.GetByEventID(eventID)
		allAvail, _ := h.availability.GetByEventID(eventID)
		response = buildParticipantView(event, participant, participants, allAvail)
	default:
		response = buildPublicView(event)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// JoinEvent, GetMyParticipation, UpdateMyParticipation, ReplaceAvailability,
// UpdateEvent, SuggestDate follow the same pattern:
// 1. Parse request
// 2. Resolve auth
// 3. Call repository
// 4. Broadcast WebSocket message
// 5. Return JSON response
//
// Each method is ~30-50 lines of straightforward request→domain→response mapping.
// The implementing engineer should follow the CreateEvent and GetEvent patterns above.

func parseVisibility(raw json.RawMessage) (domain.VisibilityPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "names-visible":
		return domain.NamesVisibleVisibility{}, nil
	case "anonymous":
		return domain.AnonymousVisibility{}, nil
	default:
		return nil, fmt.Errorf("unknown visibility kind: %s", v.Kind)
	}
}

func parseSuggestionPolicy(raw json.RawMessage) (domain.SuggestionPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "open":
		return domain.OpenSuggestionPolicy{}, nil
	case "closed":
		return domain.ClosedSuggestionPolicy{}, nil
	default:
		return nil, fmt.Errorf("unknown suggestion policy kind: %s", v.Kind)
	}
}

// View builders — these construct the polymorphic response shapes

func buildPublicView(event *domain.Event) map[string]any {
	return map[string]any{
		"role":           "public",
		"id":             event.ID,
		"title":          event.Title,
		"description":    event.Description,
		"timezone":       event.Timezone,
		"timeSlotConfig": buildTimeSlotConfig(event.TimeSlotConfig),
		"dates":          buildDates(event.Dates),
	}
}

func buildHostView(event *domain.Event, participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry) map[string]any {
	view := buildPublicView(event)
	view["role"] = "host"
	view["visibility"] = buildVisibility(event.Visibility)
	view["suggestions"] = buildSuggestionPolicy(event.Suggestions)
	view["participants"] = buildParticipantsWithAvailability(participants, allAvail)
	return view
}

func buildParticipantView(event *domain.Event, me *domain.Participant, participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry) map[string]any {
	view := buildPublicView(event)
	view["role"] = "participant"
	view["visibility"] = buildVisibility(event.Visibility)
	view["suggestions"] = buildSuggestionPolicy(event.Suggestions)
	view["participants"] = buildParticipantsWithAvailability(participants, allAvail)
	return view
}

func buildTimeSlotConfig(c domain.TimeSlotConfig) map[string]any {
	return map[string]any{
		"durationMinutes": c.DurationMinutes,
		"rangeStart":      c.RangeStart,
		"rangeEnd":        c.RangeEnd,
	}
}

func buildVisibility(v domain.VisibilityPolicy) map[string]any {
	switch v.(type) {
	case domain.NamesVisibleVisibility:
		return map[string]any{"kind": "names-visible"}
	case domain.AnonymousVisibility:
		return map[string]any{"kind": "anonymous"}
	default:
		return nil
	}
}

func buildSuggestionPolicy(s domain.SuggestionPolicy) map[string]any {
	switch s.(type) {
	case domain.OpenSuggestionPolicy:
		return map[string]any{"kind": "open"}
	case domain.ClosedSuggestionPolicy:
		return map[string]any{"kind": "closed"}
	default:
		return nil
	}
}

func buildDates(dates []domain.EventDate) []map[string]any {
	result := make([]map[string]any, len(dates))
	for i, d := range dates {
		m := map[string]any{"id": d.ID, "date": d.Date}
		switch o := d.Origin.(type) {
		case domain.HostSuggestedOrigin:
			m["origin"] = "host"
		case domain.ParticipantSuggestedOrigin:
			m["origin"] = "participant"
			m["participantId"] = o.ParticipantID
		}
		result[i] = m
	}
	return result
}

func buildParticipantsWithAvailability(participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry) []map[string]any {
	result := make([]map[string]any, len(participants))
	for i, p := range participants {
		entries := allAvail[p.ID]
		avail := make([]map[string]any, len(entries))
		for j, e := range entries {
			m := map[string]any{"eventDateId": e.EventDateID, "slot": e.Slot}
			switch k := e.Kind.(type) {
			case domain.AvailableKind:
				m["kind"] = "available"
			case domain.IfNeededKind:
				m["kind"] = "if-needed"
				if k.Reason != "" {
					m["reason"] = k.Reason
				}
			}
			avail[j] = m
		}
		result[i] = map[string]any{
			"id":           p.ID,
			"name":         p.Name,
			"note":         p.Note,
			"availability": avail,
		}
	}
	return result
}
```

Note: add `"fmt"` and `"time"` imports as needed.

- [ ] **Step 4: Write main.go — `server/cmd/server/main.go`**

```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/handler"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

func main() {
	port := envOr("PORT", "8080")
	dbPath := envOr("DATABASE_PATH", "./availability.db")
	allowedOrigin := envOr("ALLOWED_ORIGIN", "http://localhost:5173")

	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	eventRepo := repository.NewSQLiteEventRepo(database)
	participantRepo := repository.NewSQLiteParticipantRepo(database)
	dateRepo := repository.NewSQLiteEventDateRepo(database)
	availRepo := repository.NewSQLiteAvailabilityRepo(database)
	broadcast := ws.NewBroadcast()

	h := handler.New(eventRepo, participantRepo, dateRepo, availRepo, broadcast)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{allowedOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.Post("/events", h.CreateEvent)
	r.Get("/events/{eventId}", func(w http.ResponseWriter, r *http.Request) {
		h.GetEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Patch("/events/{eventId}", func(w http.ResponseWriter, r *http.Request) {
		h.UpdateEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Post("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.JoinEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Get("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.GetMyParticipation(w, r, chi.URLParam(r, "eventId"))
	})
	r.Patch("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.UpdateMyParticipation(w, r, chi.URLParam(r, "eventId"))
	})
	r.Put("/events/{eventId}/me/availability", func(w http.ResponseWriter, r *http.Request) {
		h.ReplaceAvailability(w, r, chi.URLParam(r, "eventId"))
	})
	r.Post("/events/{eventId}/dates", func(w http.ResponseWriter, r *http.Request) {
		h.SuggestDate(w, r, chi.URLParam(r, "eventId"))
	})

	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 5: Install Go dependencies**

```bash
cd server && go get github.com/go-chi/chi/v5 github.com/go-chi/cors
go mod tidy
```

- [ ] **Step 6: Write HTTP integration test — `server/internal/handler/handler_test.go`**

```go
package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/handler"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

func setupServer(t *testing.T) (*chi.Mux, func()) {
	t.Helper()
	database, _ := db.New(":memory:")
	db.Migrate(database)

	h := handler.New(
		repository.NewSQLiteEventRepo(database),
		repository.NewSQLiteParticipantRepo(database),
		repository.NewSQLiteEventDateRepo(database),
		repository.NewSQLiteAvailabilityRepo(database),
		ws.NewBroadcast(),
	)

	r := chi.NewRouter()
	r.Post("/events", h.CreateEvent)
	r.Get("/events/{eventId}", func(w http.ResponseWriter, req *http.Request) {
		h.GetEvent(w, req, chi.URLParam(req, "eventId"))
	})
	r.Post("/events/{eventId}/me", func(w http.ResponseWriter, req *http.Request) {
		h.JoinEvent(w, req, chi.URLParam(req, "eventId"))
	})

	return r, func() { database.Close() }
}

func TestCreateAndGetEvent(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	body := `{
		"title": "Team Standup",
		"timezone": "Europe/Helsinki",
		"timeSlotConfig": {"durationMinutes": 30, "rangeStart": "09:00", "rangeEnd": "17:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": ["2026-07-15", "2026-07-16"]
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201. body: %s", w.Code, w.Body.String())
	}

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]
	hostToken := createResp["hostToken"]

	if eventID == "" || hostToken == "" {
		t.Fatal("missing eventId or hostToken in response")
	}

	// Get as anonymous
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", w.Code)
	}

	var eventResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &eventResp)
	if eventResp["role"] != "public" {
		t.Errorf("role = %v, want public", eventResp["role"])
	}

	// Get as host
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	json.Unmarshal(w.Body.Bytes(), &eventResp)
	if eventResp["role"] != "host" {
		t.Errorf("role = %v, want host", eventResp["role"])
	}
}
```

- [ ] **Step 7: Run tests**

```bash
cd server && go test ./... -v
```

Expected: all tests pass.

- [ ] **Step 8: Verify the server starts**

```bash
cd server && go run ./cmd/server/
```

Expected: `listening on :8080`. Ctrl+C to stop.

- [ ] **Step 9: Commit**

```bash
git add server/
git commit -m "feat: add HTTP handlers, auth, WebSocket broadcast, and main.go"
```

---

### Task 6: Web Foundation + Shared Layer

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.js`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/app.tsx`
- Create: `web/src/shared/api/client.ts`
- Create: `web/src/shared/api/token.ts`
- Create: `web/src/shared/api/ws.ts`
- Create: `web/src/shared/routing/router.tsx`

**Interfaces:**
- Consumes: generated TypeScript types from `web/src/shared/api/generated/schema.d.ts`
- Produces: running Vite dev server, configured openapi-fetch client, token management utilities, WebSocket hook, TanStack Router with token extraction

- [ ] **Step 1: Initialize web project**

```bash
cd web && pnpm init
pnpm add react react-dom react-aria-components @tanstack/react-query @tanstack/react-router openapi-fetch
pnpm add -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss postcss autoprefixer
npx tailwindcss init -p --ts
```

- [ ] **Step 2: Create config files**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
})
```

`web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Availability</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Write shared API client — `web/src/shared/api/client.ts`**

```typescript
import createClient from 'openapi-fetch'
import type { paths } from './generated/schema'
import { getToken } from './token'

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export const api = createClient<paths>({
  baseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.use({
  onRequest({ request }) {
    const url = new URL(request.url)
    const eventId = url.pathname.match(/\/events\/([^/]+)/)?.[1]
    if (eventId) {
      const token = getToken(eventId)
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }
    }
    return request
  },
})
```

- [ ] **Step 4: Write token management — `web/src/shared/api/token.ts`**

```typescript
const TOKEN_PREFIX = 'availability_token_'

export function getToken(eventId: string): string | null {
  return localStorage.getItem(TOKEN_PREFIX + eventId)
}

export function setToken(eventId: string, token: string): void {
  localStorage.setItem(TOKEN_PREFIX + eventId, token)
}

export function removeToken(eventId: string): void {
  localStorage.removeItem(TOKEN_PREFIX + eventId)
}
```

- [ ] **Step 5: Write WebSocket hook — `web/src/shared/api/ws.ts`**

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getToken } from './token'

type EventMessage = {
  kind: 'availability-updated' | 'participant-joined' | 'date-suggested' | 'settings-changed'
  participantId?: string
  name?: string
  eventDateId?: string
  date?: string
}

const WS_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080')
  .replace(/^http/, 'ws')

export function useEventWebSocket(eventId: string | undefined) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>()
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    if (!eventId) return

    const token = getToken(eventId)
    const url = `${WS_BASE}/events/${eventId}/live${token ? `?token=${token}` : ''}`
    const ws = new WebSocket(url)

    ws.onopen = () => {
      retryCount.current = 0
    }

    ws.onmessage = (event) => {
      const msg: EventMessage = JSON.parse(event.data)
      switch (msg.kind) {
        case 'availability-updated':
        case 'participant-joined':
        case 'settings-changed':
        case 'date-suggested':
          queryClient.invalidateQueries({ queryKey: ['event', eventId] })
          break
      }
    }

    ws.onclose = () => {
      const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
      retryCount.current++
      reconnectTimeout.current = setTimeout(connect, delay)
    }

    wsRef.current = ws
  }, [eventId, queryClient])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimeout.current)
      wsRef.current?.close()
    }
  }, [connect])
}
```

- [ ] **Step 6: Write router — `web/src/shared/routing/router.tsx`**

```typescript
import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router'

const rootRoute = createRootRoute()

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <div>Home — Create an event</div>,
})

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: () => <div>Event view</div>,
})

const eventWithTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/$token',
  component: () => <div>Token extraction</div>,
})

const routeTree = rootRoute.addChildren([indexRoute, eventRoute, eventWithTokenRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

- [ ] **Step 7: Write app entry — `web/src/main.tsx` and `web/src/app.tsx`**

`web/src/main.tsx`:
```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

`web/src/app.tsx`:
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './shared/routing/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

- [ ] **Step 8: Verify dev server starts**

```bash
cd web && pnpm dev
```

Expected: Vite dev server on `http://localhost:5173`, page loads with "Home — Create an event".

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "feat: add web foundation with API client, token management, and routing"
```

---

### Task 7: Create Event Feature

**Files:**
- Create: `web/src/features/event-config/CreateEventPage.tsx`
- Modify: `web/src/shared/routing/router.tsx` (add route)

**Interfaces:**
- Consumes: `api` client, `setToken()`
- Produces: create event form that POSTs to API, redirects to host URL on success

- [ ] **Step 1: Write create event page — `web/src/features/event-config/CreateEventPage.tsx`**

```typescript
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, TextField, Input, Label, Select, SelectValue, Popover, ListBox, ListBoxItem } from 'react-aria-components'
import { api } from '@/shared/api/client'
import { setToken } from '@/shared/api/token'

export function CreateEventPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [durationMinutes, setDurationMinutes] = useState<15 | 30 | 60>(30)
  const [rangeStart, setRangeStart] = useState('09:00')
  const [rangeEnd, setRangeEnd] = useState('17:00')
  const [visibility, setVisibility] = useState<'names-visible' | 'anonymous'>('names-visible')
  const [suggestions, setSuggestions] = useState<'open' | 'closed'>('open')
  const [dates, setDates] = useState<string[]>([])
  const [dateInput, setDateInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const addDate = () => {
    if (dateInput && !dates.includes(dateInput)) {
      setDates([...dates, dateInput].sort())
      setDateInput('')
    }
  }

  const removeDate = (date: string) => {
    setDates(dates.filter(d => d !== date))
  }

  const submit = async () => {
    if (!title || dates.length === 0) return
    setSubmitting(true)

    const { data, error } = await api.POST('/events', {
      body: {
        title,
        description: description || undefined,
        timezone,
        timeSlotConfig: { durationMinutes, rangeStart, rangeEnd },
        visibility: { kind: visibility },
        suggestions: { kind: suggestions },
        dates,
      },
    })

    if (error || !data) {
      setSubmitting(false)
      return
    }

    setToken(data.eventId, data.hostToken)
    navigate({ to: '/events/$eventId', params: { eventId: data.eventId } })
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create Event</h1>

      <TextField className="mb-4" value={title} onChange={setTitle}>
        <Label className="block text-sm font-medium mb-1">Title</Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <TextField className="mb-4" value={description} onChange={setDescription}>
        <Label className="block text-sm font-medium mb-1">Description (optional)</Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Timezone</label>
        <p className="text-sm text-gray-600">{timezone}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">Duration</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={durationMinutes}
            onChange={e => setDurationMinutes(Number(e.target.value) as 15 | 30 | 60)}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">From</label>
          <input type="time" className="w-full border rounded px-3 py-2" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">To</label>
          <input type="time" className="w-full border rounded px-3 py-2" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">Names</label>
          <select className="w-full border rounded px-3 py-2" value={visibility} onChange={e => setVisibility(e.target.value as any)}>
            <option value="names-visible">Visible</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date suggestions</label>
          <select className="w-full border rounded px-3 py-2" value={suggestions} onChange={e => setSuggestions(e.target.value as any)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-1">Dates</label>
        <div className="flex gap-2 mb-2">
          <input type="date" className="flex-1 border rounded px-3 py-2" value={dateInput} onChange={e => setDateInput(e.target.value)} />
          <button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={addDate}>Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {dates.map(d => (
            <span key={d} className="inline-flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-sm">
              {d}
              <button className="text-gray-500 hover:text-red-500" onClick={() => removeDate(d)}>×</button>
            </span>
          ))}
        </div>
      </div>

      <button
        className="w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        disabled={!title || dates.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? 'Creating...' : 'Create Event'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update router to add create event route**

Add to `web/src/shared/routing/router.tsx`:

```typescript
import { CreateEventPage } from '@/features/event-config/CreateEventPage'

// Update indexRoute:
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CreateEventPage,
})
```

- [ ] **Step 3: Verify in browser**

Start both servers:
```bash
cd server && go run ./cmd/server/ &
cd web && pnpm dev
```

Open `http://localhost:5173`. Fill in the form, create an event. Verify it redirects to `/events/:id`.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/event-config/ web/src/shared/routing/router.tsx
git commit -m "feat: add create event page"
```

---

### Task 8: Join Feature + Event View

**Files:**
- Create: `web/src/features/join/JoinPage.tsx`
- Create: `web/src/features/join/EventView.tsx`
- Modify: `web/src/shared/routing/router.tsx`

**Interfaces:**
- Consumes: `api` client, `getToken()`, `setToken()`, `useEventWebSocket()`
- Produces: public join page, authenticated event view with role-based rendering

- [ ] **Step 1: Write the event view component — `web/src/features/join/EventView.tsx`**

This is the main event page that renders differently based on role (public → join form, participant/host → grid + results).

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { JoinPage } from './JoinPage'

export function EventView({ eventId }: { eventId: string }) {
  useEventWebSocket(eventId)

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  if (isLoading) return <div className="p-4">Loading...</div>
  if (error || !data) return <div className="p-4">Event not found</div>

  if (data.role === 'public') {
    return <JoinPage eventId={eventId} event={data} />
  }

  // Participant or host view — grid and results will be added in later tasks
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
      {data.description && <p className="text-gray-600 mb-4">{data.description}</p>}
      <p className="text-sm text-gray-500 mb-4">
        {data.timezone} · {data.role === 'host' ? 'You are the host' : 'Participant view'}
      </p>
      <p className="text-sm text-gray-400">Grid and results view coming next...</p>
    </div>
  )
}
```

- [ ] **Step 2: Write join page — `web/src/features/join/JoinPage.tsx`**

```typescript
import { useState } from 'react'
import { TextField, Input, Label } from 'react-aria-components'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { setToken } from '@/shared/api/token'

type Props = {
  eventId: string
  event: { title: string; description?: string }
}

export function JoinPage({ eventId, event }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const join = async () => {
    if (!name.trim()) return
    setSubmitting(true)

    const { data, error } = await api.POST('/events/{eventId}/me', {
      params: { path: { eventId } },
      body: { name: name.trim() },
    })

    if (error || !data) {
      setSubmitting(false)
      return
    }

    setToken(eventId, data.token)
    queryClient.invalidateQueries({ queryKey: ['event', eventId] })
  }

  return (
    <div className="max-w-md mx-auto p-4 text-center">
      <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
      {event.description && <p className="text-gray-600 mb-6">{event.description}</p>}

      <TextField className="mb-4 text-left" value={name} onChange={setName}>
        <Label className="block text-sm font-medium mb-1">Your name</Label>
        <Input className="w-full border rounded px-3 py-2" placeholder="Enter your name" />
      </TextField>

      <button
        className="w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        disabled={!name.trim() || submitting}
        onClick={join}
      >
        {submitting ? 'Joining...' : 'Join'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Update router with token extraction**

Replace the event routes in `web/src/shared/routing/router.tsx`:

```typescript
import { EventView } from '@/features/join/EventView'
import { setToken } from '@/shared/api/token'
import { redirect } from '@tanstack/react-router'

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: () => {
    const { eventId } = eventRoute.useParams()
    return <EventView eventId={eventId} />
  },
})

const eventWithTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/$token',
  beforeLoad: ({ params }) => {
    setToken(params.eventId, params.token)
    throw redirect({ to: '/events/$eventId', params: { eventId: params.eventId } })
  },
})
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:5173/events/<some-event-id>` (use an ID from a previously created event). Should see join page. Enter name, join. Should see the event view with title.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/join/ web/src/shared/routing/router.tsx
git commit -m "feat: add join flow and event view with role-based rendering"
```

---

### Task 9: Availability Grid Component

**Files:**
- Create: `web/src/features/grid/AvailabilityGrid.tsx`
- Create: `web/src/features/grid/GridCell.tsx`
- Create: `web/src/features/grid/useGridInteraction.ts`
- Create: `web/src/features/grid/types.ts`

**Interfaces:**
- Consumes: event data (dates, timeSlotConfig), current availability entries
- Produces: controlled grid component that calls `onChange` with updated availability entries

This is the most complex frontend component. It handles:
- Grid rendering with dates as columns and time slots as rows
- Three-state cells (empty → available → if-needed → empty cycle)
- Pointer event drag-painting for both touch and mouse
- React Aria keyboard navigation

- [ ] **Step 1: Define grid types — `web/src/features/grid/types.ts`**

```typescript
export type CellState = 'empty' | 'available' | 'if-needed'

export type SlotEntry = {
  eventDateId: string
  slot: string // full ISO datetime
  state: CellState
  reason?: string
}

export type GridColumn = {
  eventDateId: string
  date: string
}

export type GridRow = {
  slot: string // display label, e.g. "09:00"
  datetime: string // full ISO datetime template
}
```

- [ ] **Step 2: Write the grid interaction hook — `web/src/features/grid/useGridInteraction.ts`**

```typescript
import { useRef, useCallback } from 'react'
import type { CellState, SlotEntry } from './types'

const NEXT_STATE: Record<CellState, CellState> = {
  'empty': 'available',
  'available': 'if-needed',
  'if-needed': 'empty',
}

type Params = {
  entries: SlotEntry[]
  onChange: (entries: SlotEntry[]) => void
}

export function useGridInteraction({ entries, onChange }: Params) {
  const paintState = useRef<CellState | null>(null)
  const paintedCells = useRef<Set<string>>(new Set())

  const getKey = (eventDateId: string, slot: string) => `${eventDateId}:${slot}`

  const getState = (eventDateId: string, slot: string): CellState => {
    const entry = entries.find(e => e.eventDateId === eventDateId && e.slot === slot)
    return entry?.state ?? 'empty'
  }

  const updateCell = useCallback((eventDateId: string, slot: string, newState: CellState) => {
    const key = getKey(eventDateId, slot)
    if (paintedCells.current.has(key)) return

    paintedCells.current.add(key)
    const filtered = entries.filter(e => !(e.eventDateId === eventDateId && e.slot === slot))
    if (newState !== 'empty') {
      filtered.push({ eventDateId, slot, state: newState })
    }
    onChange(filtered)
  }, [entries, onChange])

  const onPointerDown = useCallback((eventDateId: string, slot: string) => {
    const current = getState(eventDateId, slot)
    const next = NEXT_STATE[current]
    paintState.current = next
    paintedCells.current = new Set()
    updateCell(eventDateId, slot, next)
  }, [getState, updateCell])

  const onPointerEnter = useCallback((eventDateId: string, slot: string) => {
    if (paintState.current === null) return
    updateCell(eventDateId, slot, paintState.current)
  }, [updateCell])

  const onPointerUp = useCallback(() => {
    paintState.current = null
    paintedCells.current = new Set()
  }, [])

  return { getState, onPointerDown, onPointerEnter, onPointerUp }
}
```

- [ ] **Step 3: Write the grid cell — `web/src/features/grid/GridCell.tsx`**

```typescript
import { useRef } from 'react'
import type { CellState } from './types'

const STATE_CLASSES: Record<CellState, string> = {
  'empty': 'bg-gray-50 hover:bg-gray-100',
  'available': 'bg-green-400',
  'if-needed': 'bg-yellow-300',
}

const STATE_LABELS: Record<CellState, string> = {
  'empty': 'Unavailable',
  'available': 'Available',
  'if-needed': 'If needed',
}

type Props = {
  state: CellState
  onPointerDown: () => void
  onPointerEnter: () => void
}

export function GridCell({ state, onPointerDown, onPointerEnter }: Props) {
  return (
    <div
      role="gridcell"
      aria-label={STATE_LABELS[state]}
      className={`h-8 border border-gray-200 cursor-pointer select-none touch-none ${STATE_CLASSES[state]}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        onPointerDown()
      }}
      onPointerEnter={onPointerEnter}
    />
  )
}
```

- [ ] **Step 4: Write the grid component — `web/src/features/grid/AvailabilityGrid.tsx`**

```typescript
import { useMemo } from 'react'
import { GridCell } from './GridCell'
import { useGridInteraction } from './useGridInteraction'
import type { SlotEntry, GridColumn, GridRow } from './types'

type Props = {
  columns: GridColumn[]
  timeSlotConfig: {
    durationMinutes: number
    rangeStart: string
    rangeEnd: string
  }
  entries: SlotEntry[]
  onChange: (entries: SlotEntry[]) => void
}

function generateSlotRows(config: Props['timeSlotConfig']): GridRow[] {
  const rows: GridRow[] = []
  const [startH, startM] = config.rangeStart.split(':').map(Number)
  const [endH, endM] = config.rangeEnd.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  let endMinutes = endH * 60 + endM
  if (endMinutes <= startMinutes) endMinutes += 24 * 60 // midnight wrap

  for (let m = startMinutes; m < endMinutes; m += config.durationMinutes) {
    const h = Math.floor((m % (24 * 60)) / 60)
    const min = m % 60
    const label = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    rows.push({ slot: label, datetime: label })
  }
  return rows
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

export function AvailabilityGrid({ columns, timeSlotConfig, entries, onChange }: Props) {
  const rows = useMemo(() => generateSlotRows(timeSlotConfig), [timeSlotConfig])
  const { getState, onPointerDown, onPointerEnter, onPointerUp } = useGridInteraction({ entries, onChange })

  return (
    <div
      role="grid"
      aria-label="Availability grid"
      className="overflow-x-auto"
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="inline-grid" style={{
        gridTemplateColumns: `4rem repeat(${columns.length}, minmax(3rem, 1fr))`,
      }}>
        {/* Header row */}
        <div />
        {columns.map(col => (
          <div key={col.eventDateId} role="columnheader" className="text-center text-xs font-medium p-1 truncate">
            {col.date}
          </div>
        ))}

        {/* Data rows */}
        {rows.map(row => (
          <>
            <div key={`label-${row.slot}`} role="rowheader" className="text-xs text-gray-500 text-right pr-2 flex items-center justify-end">
              {row.slot}
            </div>
            {columns.map(col => {
              const fullSlot = toFullDatetime(col.date, row.datetime)
              return (
                <GridCell
                  key={`${col.eventDateId}-${row.slot}`}
                  state={getState(col.eventDateId, fullSlot)}
                  onPointerDown={() => onPointerDown(col.eventDateId, fullSlot)}
                  onPointerEnter={() => onPointerEnter(col.eventDateId, fullSlot)}
                />
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify grid renders**

Import and render the grid in `EventView.tsx` for the participant/host case (replacing the placeholder text). Pass mock data to verify the grid paints correctly.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/grid/
git commit -m "feat: add availability grid with drag-paint interaction"
```

---

### Task 10: Results View + Full Event Integration

**Files:**
- Create: `web/src/features/results/ResultsView.tsx`
- Modify: `web/src/features/join/EventView.tsx` (integrate grid + results + save)

**Interfaces:**
- Consumes: event data with participants and availability, `api` client
- Produces: per-person availability rows, save availability button, complete event experience

- [ ] **Step 1: Write results view — `web/src/features/results/ResultsView.tsx`**

```typescript
import type { GridColumn, GridRow } from '@/features/grid/types'

type ParticipantAvailability = {
  id: string
  name: string
  availability: Array<{ kind: string; eventDateId: string; slot: string }>
}

type Props = {
  columns: GridColumn[]
  rows: GridRow[]
  participants: ParticipantAvailability[]
}

const KIND_CLASSES: Record<string, string> = {
  'available': 'bg-green-400',
  'if-needed': 'bg-yellow-300',
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

export function ResultsView({ columns, rows, participants }: Props) {
  if (participants.length === 0) {
    return <p className="text-gray-500 text-sm">No responses yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      {participants.map(p => (
        <div key={p.id} className="mb-4">
          <h3 className="text-sm font-medium mb-1">{p.name}</h3>
          <div className="inline-grid" style={{
            gridTemplateColumns: `4rem repeat(${columns.length}, minmax(3rem, 1fr))`,
          }}>
            <div />
            {columns.map(col => (
              <div key={col.eventDateId} className="text-center text-xs text-gray-400 p-1 truncate">
                {col.date}
              </div>
            ))}
            {rows.map(row => (
              <>
                <div key={`label-${row.slot}`} className="text-xs text-gray-500 text-right pr-2 flex items-center justify-end">
                  {row.slot}
                </div>
                {columns.map(col => {
                  const fullSlot = toFullDatetime(col.date, row.datetime)
                  const entry = p.availability.find(a => a.eventDateId === col.eventDateId && a.slot === fullSlot)
                  const cls = entry ? KIND_CLASSES[entry.kind] ?? 'bg-gray-50' : 'bg-gray-50'
                  return (
                    <div key={`${col.eventDateId}-${row.slot}`} className={`h-6 border border-gray-200 ${cls}`} />
                  )
                })}
              </>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Integrate grid, results, and save into EventView**

Update `web/src/features/join/EventView.tsx` to render the grid for the current participant and save availability on change:

```typescript
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { JoinPage } from './JoinPage'
import { AvailabilityGrid } from '@/features/grid/AvailabilityGrid'
import { ResultsView } from '@/features/results/ResultsView'
import type { SlotEntry, GridColumn } from '@/features/grid/types'

export function EventView({ eventId }: { eventId: string }) {
  useEventWebSocket(eventId)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  const myData = useQuery({
    queryKey: ['event', eventId, 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}/me', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
    enabled: data?.role === 'participant' || data?.role === 'host',
  })

  const [localEntries, setLocalEntries] = useState<SlotEntry[] | null>(null)

  const entries: SlotEntry[] = useMemo(() => {
    if (localEntries !== null) return localEntries
    if (!myData.data?.availability) return []
    return myData.data.availability.map(a => ({
      eventDateId: a.eventDateId,
      slot: a.slot,
      state: a.kind === 'available' ? 'available' as const : 'if-needed' as const,
      reason: 'reason' in a ? a.reason : undefined,
    }))
  }, [localEntries, myData.data])

  const saveMutation = useMutation({
    mutationFn: async (newEntries: SlotEntry[]) => {
      await api.PUT('/events/{eventId}/me/availability', {
        params: { path: { eventId } },
        body: {
          entries: newEntries.map(e => ({
            kind: e.state === 'available' ? 'available' as const : 'if-needed' as const,
            eventDateId: e.eventDateId,
            slot: e.slot,
          })),
        },
      })
    },
    onSuccess: () => {
      setLocalEntries(null)
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  const handleChange = useCallback((newEntries: SlotEntry[]) => {
    setLocalEntries(newEntries)
  }, [])

  if (isLoading) return <div className="p-4">Loading...</div>
  if (!data) return <div className="p-4">Event not found</div>
  if (data.role === 'public') return <JoinPage eventId={eventId} event={data} />

  const columns: GridColumn[] = data.dates.map(d => ({
    eventDateId: d.id,
    date: d.date,
  }))

  const isParticipant = data.role === 'participant'

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
      {data.description && <p className="text-gray-600 mb-4">{data.description}</p>}
      <p className="text-sm text-gray-500 mb-6">
        {data.timezone} · {data.role === 'host' ? 'Host' : 'Participant'}
      </p>

      {(isParticipant || data.role === 'host') && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Your Availability</h2>
          <AvailabilityGrid
            columns={columns}
            timeSlotConfig={data.timeSlotConfig}
            entries={entries}
            onChange={handleChange}
          />
          {localEntries !== null && (
            <button
              className="mt-3 px-6 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(entries)}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          )}
        </section>
      )}

      {'participants' in data && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Responses</h2>
          <ResultsView
            columns={columns}
            rows={[]} // TODO: generate from timeSlotConfig — reuse generateSlotRows
            participants={data.participants}
          />
        </section>
      )}
    </div>
  )
}
```

Note: the `generateSlotRows` function should be extracted to a shared location (e.g. `web/src/features/grid/slots.ts`) and used by both `AvailabilityGrid` and `ResultsView`. The implementing engineer should do this extraction.

- [ ] **Step 3: Test the full flow in browser**

1. Create event at `/`
2. Copy the event URL, open in incognito
3. Join as a participant
4. Paint availability on the grid
5. Save
6. See results update in real-time on the host's tab

- [ ] **Step 4: Commit**

```bash
git add web/src/features/
git commit -m "feat: add results view and full event integration with save"
```

---

### Task 11: Storybook + Loki Visual Tests

**Files:**
- Create: `web/.storybook/main.ts`
- Create: `web/.storybook/preview.ts`
- Create: `web/src/features/grid/AvailabilityGrid.stories.tsx`
- Create: `web/loki.config.js`

**Interfaces:**
- Consumes: `AvailabilityGrid`, `GridCell` components
- Produces: Storybook stories + Loki visual regression snapshots

- [ ] **Step 1: Install Storybook + Loki**

```bash
cd web && npx storybook@latest init --builder vite --skip-install
pnpm install
pnpm add -D loki
```

- [ ] **Step 2: Write grid stories — `web/src/features/grid/AvailabilityGrid.stories.tsx`**

```typescript
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { AvailabilityGrid } from './AvailabilityGrid'
import type { SlotEntry, GridColumn } from './types'

const columns: GridColumn[] = [
  { eventDateId: 'd1', date: '2026-07-15' },
  { eventDateId: 'd2', date: '2026-07-16' },
  { eventDateId: 'd3', date: '2026-07-17' },
]

const timeSlotConfig = { durationMinutes: 30 as const, rangeStart: '09:00', rangeEnd: '12:00' }

const meta: Meta<typeof AvailabilityGrid> = {
  title: 'Grid/AvailabilityGrid',
  component: AvailabilityGrid,
}
export default meta

type Story = StoryObj<typeof AvailabilityGrid>

function InteractiveGrid(props: { initial?: SlotEntry[] }) {
  const [entries, setEntries] = useState<SlotEntry[]>(props.initial ?? [])
  return <AvailabilityGrid columns={columns} timeSlotConfig={timeSlotConfig} entries={entries} onChange={setEntries} />
}

export const Empty: Story = {
  render: () => <InteractiveGrid />,
}

export const WithAvailability: Story = {
  render: () => (
    <InteractiveGrid initial={[
      { eventDateId: 'd1', slot: '2026-07-15T09:00', state: 'available' },
      { eventDateId: 'd1', slot: '2026-07-15T09:30', state: 'available' },
      { eventDateId: 'd1', slot: '2026-07-15T10:00', state: 'if-needed' },
      { eventDateId: 'd2', slot: '2026-07-16T09:00', state: 'available' },
      { eventDateId: 'd2', slot: '2026-07-16T09:30', state: 'available' },
      { eventDateId: 'd2', slot: '2026-07-16T10:00', state: 'available' },
      { eventDateId: 'd2', slot: '2026-07-16T10:30', state: 'if-needed' },
    ]} />
  ),
}

export const MidnightWrap: Story = {
  render: () => {
    const [entries, setEntries] = useState<SlotEntry[]>([])
    return (
      <AvailabilityGrid
        columns={[{ eventDateId: 'd1', date: '2026-07-15' }]}
        timeSlotConfig={{ durationMinutes: 30, rangeStart: '22:00', rangeEnd: '02:00' }}
        entries={entries}
        onChange={setEntries}
      />
    )
  },
}

export const MobileWidth: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <InteractiveGrid />,
}
```

- [ ] **Step 3: Configure Loki — `web/loki.config.js`**

```javascript
module.exports = {
  configurations: {
    'chrome.laptop': {
      target: 'chrome.docker',
      width: 1366,
      height: 768,
    },
    'chrome.mobile': {
      target: 'chrome.docker',
      width: 375,
      height: 812,
    },
  },
}
```

- [ ] **Step 4: Run Storybook and verify stories**

```bash
cd web && pnpm storybook
```

Open Storybook, verify all 4 stories render correctly.

- [ ] **Step 5: Generate Loki reference screenshots**

```bash
cd web && pnpm loki update
```

- [ ] **Step 6: Run Loki tests**

```bash
cd web && pnpm loki test
```

Expected: all visual tests pass (matching reference screenshots).

- [ ] **Step 7: Commit**

```bash
git add web/.storybook/ web/src/features/grid/AvailabilityGrid.stories.tsx web/loki.config.js web/.loki/
git commit -m "feat: add Storybook stories and Loki visual regression tests for grid"
```

---

### Task 12: WebSocket Server Handler + Remaining Handler Methods

**Files:**
- Modify: `server/cmd/server/main.go` (add WebSocket route)
- Create: `server/internal/handler/ws_handler.go`
- Modify: `server/internal/handler/handler.go` (implement remaining methods)

**Interfaces:**
- Consumes: `ws.Broadcast`, auth resolver, WebSocket library
- Produces: working WebSocket endpoint at `/events/{eventId}/live`, complete handler implementation

- [ ] **Step 1: Install WebSocket library**

```bash
cd server && go get nhooyr.io/websocket
```

- [ ] **Step 2: Write WebSocket handler — `server/internal/handler/ws_handler.go`**

```go
package handler

import (
	"context"
	"net/http"
	"time"

	"nhooyr.io/websocket"

	"github.com/pennane/availability/server/internal/ws"
)

func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request, eventID string) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	role, _ := h.auth.Resolve(r, eventID)
	if role == RoleAnonymous {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	client := &ws.Client{Send: make(chan []byte, 16)}
	h.broadcast.Subscribe(eventID, client)
	defer h.broadcast.Unsubscribe(eventID, client)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Read pump (detect disconnects)
	go func() {
		for {
			_, _, err := conn.Read(ctx)
			if err != nil {
				cancel()
				return
			}
		}
	}()

	// Write pump
	for {
		select {
		case msg, ok := <-client.Send:
			if !ok {
				return
			}
			ctx2, c2 := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(ctx2, websocket.MessageText, msg)
			c2()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
```

- [ ] **Step 3: Add WebSocket route to main.go**

Add to the router in `server/cmd/server/main.go`:

```go
r.Get("/events/{eventId}/live", func(w http.ResponseWriter, r *http.Request) {
    h.HandleWebSocket(w, r, chi.URLParam(r, "eventId"))
})
```

- [ ] **Step 4: Implement remaining handler methods**

Add to `server/internal/handler/handler.go` — `JoinEvent`, `GetMyParticipation`, `UpdateMyParticipation`, `ReplaceAvailability`, `UpdateEvent`, `SuggestDate`. Each follows the same pattern as `CreateEvent` and `GetEvent`: parse request → resolve auth → call repository → broadcast → respond. The implementing engineer should complete these following the existing patterns.

Key broadcast calls to include in each method:

```go
// In JoinEvent, after creating participant:
h.broadcast.Send(eventID, ws.EventMessage{Kind: "participant-joined", ParticipantID: p.ID, Name: p.Name}, nil)

// In ReplaceAvailability, after replacing:
h.broadcast.Send(eventID, ws.EventMessage{Kind: "availability-updated", ParticipantID: participant.ID}, nil)

// In SuggestDate, after creating date:
h.broadcast.Send(eventID, ws.EventMessage{Kind: "date-suggested", EventDateID: ed.ID, Date: ed.Date}, nil)

// In UpdateEvent, after updating:
h.broadcast.Send(eventID, ws.EventMessage{Kind: "settings-changed"}, nil)
```

- [ ] **Step 5: Run all tests**

```bash
cd server && go test ./... -v
```

Expected: all tests pass.

- [ ] **Step 6: Test WebSocket in browser**

Open two browser tabs to the same event. Paint availability in one, see the results update in the other.

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "feat: add WebSocket handler and complete remaining HTTP handler methods"
```

---

### Task 13: Polish + End-to-End Verification

**Files:**
- Modify: various (CSS, layout, final tweaks)

**Interfaces:**
- Consumes: everything from previous tasks
- Produces: a complete, working application

- [ ] **Step 1: Add Tailwind global styles**

Create `web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Import in `web/src/main.tsx`:
```typescript
import './index.css'
```

- [ ] **Step 2: Verify full flow end-to-end**

1. Start server: `cd server && go run ./cmd/server/`
2. Start web: `cd web && VITE_API_URL=http://localhost:8080 pnpm dev`
3. Create event at `http://localhost:5173/`
4. Copy event link, open in incognito, join as participant
5. Paint availability, save
6. See results update in real-time on host tab
7. Test on mobile viewport (Chrome DevTools device emulation)
8. Test keyboard navigation in the grid

- [ ] **Step 3: Run all tests**

```bash
cd server && go test ./... -v
cd web && pnpm test
cd web && pnpm loki test
```

- [ ] **Step 4: Build and verify production build**

```bash
cd server && GOOS=linux GOARCH=amd64 go build -o availability-server ./cmd/server
cd web && pnpm build
```

Expected: both build successfully.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: polish and verify end-to-end flow"
```
