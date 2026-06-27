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
