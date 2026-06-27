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
