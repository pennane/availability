package cleanup_test

import (
	"database/sql"
	"testing"
	"time"

	"github.com/pennane/availability/server/internal/cleanup"
	"github.com/pennane/availability/server/internal/db"
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

func insertEvent(t *testing.T, database *sql.DB, id, createdAt string, dates []string) {
	t.Helper()
	_, err := database.Exec(`INSERT INTO events (id, title, host_token, timezone, slot_duration_minutes, time_range_start, time_range_end, created_at)
		VALUES (?, 'Test', ?, 'Europe/Helsinki', 30, '09:00', '17:00', ?)`, id, "tok-"+id, createdAt)
	if err != nil {
		t.Fatal(err)
	}
	database.Exec(`INSERT INTO names_visible_visibility (event_id) VALUES (?)`, id)
	database.Exec(`INSERT INTO open_suggestion_policy (event_id) VALUES (?)`, id)
	for i, d := range dates {
		dateID := id + "-d" + string(rune('0'+i))
		database.Exec(`INSERT INTO event_dates (id, event_id, date) VALUES (?, ?, ?)`, dateID, id, d)
		database.Exec(`INSERT INTO host_suggested_dates (event_date_id) VALUES (?)`, dateID)
	}
}

func eventExists(t *testing.T, database *sql.DB, id string) bool {
	t.Helper()
	var count int
	database.QueryRow(`SELECT COUNT(*) FROM events WHERE id = ?`, id).Scan(&count)
	return count > 0
}

func TestDeleteExpired_DateBased(t *testing.T) {
	database := setupTestDB(t)

	old := time.Now().AddDate(0, 0, -30).Format(time.RFC3339)
	recent := time.Now().AddDate(0, 0, -1).Format(time.RFC3339)

	// Event with all dates >14 days ago — should be deleted
	insertEvent(t, database, "old-dates", old, []string{"2026-01-01", "2026-01-05"})

	// Event with a recent date — should survive
	future := time.Now().AddDate(0, 0, 5).Format("2006-01-02")
	insertEvent(t, database, "future-dates", recent, []string{future})

	// Event with mix: one old, one future — should survive (latest date is future)
	insertEvent(t, database, "mixed-dates", old, []string{"2026-01-01", future})

	n, err := cleanup.DeleteExpired(database)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1", n)
	}
	if eventExists(t, database, "old-dates") {
		t.Error("old-dates should have been deleted")
	}
	if !eventExists(t, database, "future-dates") {
		t.Error("future-dates should survive")
	}
	if !eventExists(t, database, "mixed-dates") {
		t.Error("mixed-dates should survive")
	}
}

func TestDeleteExpired_InactivityBased(t *testing.T) {
	database := setupTestDB(t)

	// Event with no dates, created >60 days ago — should be deleted
	old := time.Now().AddDate(0, 0, -90).Format(time.RFC3339)
	insertEvent(t, database, "abandoned", old, nil)

	// Event with no dates, created recently — should survive
	recent := time.Now().AddDate(0, 0, -5).Format(time.RFC3339)
	insertEvent(t, database, "new-no-dates", recent, nil)

	n, err := cleanup.DeleteExpired(database)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1", n)
	}
	if eventExists(t, database, "abandoned") {
		t.Error("abandoned should have been deleted")
	}
	if !eventExists(t, database, "new-no-dates") {
		t.Error("new-no-dates should survive")
	}
}

func TestDeleteExpired_CascadesChildren(t *testing.T) {
	database := setupTestDB(t)

	old := time.Now().AddDate(0, 0, -30).Format(time.RFC3339)
	insertEvent(t, database, "cascade-evt", old, []string{"2026-01-01"})

	// Add a participant and availability
	database.Exec(`INSERT INTO participants (id, event_id, name, token) VALUES ('p1', 'cascade-evt', 'Alice', 'ptok1')`)
	database.Exec(`INSERT INTO availability (id, participant_id, event_date_id, event_id, slot) VALUES ('a1', 'p1', 'cascade-evt-d0', 'cascade-evt', '2026-01-01T09:00')`)
	database.Exec(`INSERT INTO available_availability (availability_id) VALUES ('a1')`)
	database.Exec(`INSERT INTO share_links (id, event_id, token, label, created_at) VALUES ('sl1', 'cascade-evt', 'sltok1', 'link', ?)`, old)

	n, err := cleanup.DeleteExpired(database)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("deleted = %d, want 1", n)
	}

	// Verify all children are gone
	var count int
	database.QueryRow(`SELECT COUNT(*) FROM participants WHERE event_id = 'cascade-evt'`).Scan(&count)
	if count != 0 {
		t.Errorf("participants remaining = %d, want 0", count)
	}
	database.QueryRow(`SELECT COUNT(*) FROM availability WHERE event_id = 'cascade-evt'`).Scan(&count)
	if count != 0 {
		t.Errorf("availability remaining = %d, want 0", count)
	}
	database.QueryRow(`SELECT COUNT(*) FROM share_links WHERE event_id = 'cascade-evt'`).Scan(&count)
	if count != 0 {
		t.Errorf("share_links remaining = %d, want 0", count)
	}
}
