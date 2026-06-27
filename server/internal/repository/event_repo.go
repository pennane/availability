package repository

import (
	"database/sql"
	"fmt"
	"time"

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
