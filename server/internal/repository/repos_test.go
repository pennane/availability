package repository_test

import (
	"database/sql"
	"testing"
	"time"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

func seedEvent(t *testing.T, database *sql.DB) domain.Event {
	t.Helper()
	repo := repository.NewSQLiteEventRepo(database)
	event := domain.Event{
		ID:        domain.NewID(),
		Title:     "Test Event",
		HostToken: domain.NewToken(),
		Timezone:  "Europe/Helsinki",
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
