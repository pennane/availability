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
