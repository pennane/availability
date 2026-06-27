# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RSVP / scheduling helper — an event host creates a poll to probe guests for availability. Guests respond with one-click simplicity. The core UX goal is minimal friction: fewest possible clicks to submit availability.

## Architecture

Monorepo with three top-level directories:

- **`api/`**: OpenAPI 3.1 spec (YAML) — single source of truth for the API contract. Generates Go server types (oapi-codegen) and TypeScript client types (openapi-typescript).
- **`server/`**: Go module. chi router + modernc.org/sqlite (pure Go, no CGO) + WebSocket. DI via interfaces + constructor injection.
- **`web/`**: React SPA (Vite), deployed to Vercel. TanStack Query + Router, React Aria, Tailwind CSS, openapi-fetch for type-safe API calls.

`web/` managed with pnpm. Go module is independent — no shared package manager.

## Data Model

Class table inheritance in SQLite — each discriminated union variant is its own table. Row existence is the discriminant. No booleans, no JSON columns, no `kind` text columns. Variant exclusivity enforced by `BEFORE INSERT` triggers + SQL transactions. `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` required at every connection. All variant FKs use `ON DELETE CASCADE`. Entity IDs are UUIDv7. Go domain types use sealed interfaces (unexported method pattern) for discriminated unions.

## Key Patterns

- **OpenAPI-first**: spec in `api/openapi.yaml` drives codegen for both Go and TypeScript. WebSocket messages are the only hand-maintained contract (4 message kinds).
- **Feature-sliced frontend**: features never import from other features. Shared concerns in `shared/`.
- **WebSocket as notification bus**: broadcasts typed `kind`-discriminated messages, client invalidates TanStack Query cache and refetches. Not a data transport.
- **Token auth**: 128-bit base64url tokens. Delivered via URL path segment on first visit, stored in `localStorage`, sent as `Authorization: Bearer` header on API calls.
- **Timezone**: host's IANA timezone stored on the event. Slots stored as full ISO datetimes in host timezone (supports midnight-crossing ranges). Optional client-side conversion via `Intl.DateTimeFormat`.
- **Immutable grid fields**: `timezone`, `slot_duration_minutes`, `time_range_start`, `time_range_end` are immutable after event creation — changing them would corrupt existing availability.
- **CORS**: server allows requests from configured frontend origin only (env var). Not wildcard.

## Deployment

Backend: single Go binary, SCP to VPS, Caddy reverse proxy for auto-TLS, systemd for process management. No Docker, no Node.js on the server.

Frontend: Vite build deployed to Vercel. `VITE_API_URL` env var points to the backend.

## Custom Calendar Component

Built with React Aria for accessibility. Touch interaction via pointer events (device-agnostic). Visual regression tests with Loki + Storybook.

## Design Principles

- One-click-ness: every interaction should require the minimum possible user effort
- Browser-native first: prefer `<dialog>`, Popover API, `Intl`, pointer events over library equivalents
- Mobile-first: touch is the primary interaction target
- Accessible: WCAG compliance via React Aria; all interactive elements keyboard-navigable
- Functional where it helps: pure functions for data transforms on the frontend; interfaces + composition on the Go side
