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

	// Collect all rows before closing so we can query origins without
	// holding the cursor open (avoids a deadlock with MaxOpenConns(1)).
	var dates []domain.EventDate
	for rows.Next() {
		var ed domain.EventDate
		if err := rows.Scan(&ed.ID, &ed.EventID, &ed.Date); err != nil {
			rows.Close()
			return nil, err
		}
		dates = append(dates, ed)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for i := range dates {
		origin, err := r.getOrigin(dates[i].ID)
		if err != nil {
			return nil, err
		}
		dates[i].Origin = origin
	}
	return dates, nil
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
