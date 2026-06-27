package repository_test

import (
	"database/sql"
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
		ID:        domain.NewID(),
		Title:     "Test",
		HostToken: domain.NewToken(),
		Timezone:  "Europe/Helsinki",
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
		ID:        domain.NewID(),
		Title:     "Test",
		HostToken: token,
		Timezone:  "UTC",
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
