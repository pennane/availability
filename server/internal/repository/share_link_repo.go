package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/pennane/availability/server/internal/domain"
)

type TxOrDB interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
}

type ShareLinkRepository interface {
	Create(link domain.ShareLink) error
	CreateWithKind(db TxOrDB, link domain.ShareLink) error
	GetByToken(token string) (*domain.ShareLink, error)
	GetByEventID(eventID string) ([]domain.ShareLink, error)
	Delete(id string, eventID string) error
}

type SQLiteShareLinkRepo struct {
	db *sql.DB
}

func NewSQLiteShareLinkRepo(db *sql.DB) *SQLiteShareLinkRepo {
	return &SQLiteShareLinkRepo{db: db}
}

func (r *SQLiteShareLinkRepo) Create(link domain.ShareLink) error {
	return r.CreateWithKind(r.db, link)
}

func (r *SQLiteShareLinkRepo) CreateWithKind(db TxOrDB, link domain.ShareLink) error {
	_, err := db.Exec(
		`INSERT INTO share_links (id, event_id, token, label, created_at) VALUES (?, ?, ?, ?, ?)`,
		link.ID, link.EventID, link.Token, link.Label, link.CreatedAt.Format(time.RFC3339),
	)
	if err != nil {
		return err
	}

	switch k := link.Kind.(type) {
	case domain.GlobalShareLinkKind:
		_, err = db.Exec(`INSERT INTO global_share_links (share_link_id) VALUES (?)`, link.ID)
	case domain.IndividualShareLinkKind:
		_, err = db.Exec(
			`INSERT INTO individual_share_links (share_link_id, name, participant_id) VALUES (?, ?, ?)`,
			link.ID, k.Name, k.ParticipantID,
		)
	default:
		return fmt.Errorf("share link kind must be set")
	}
	return err
}

func (r *SQLiteShareLinkRepo) GetByToken(token string) (*domain.ShareLink, error) {
	var link domain.ShareLink
	var createdAt string
	var indName, indParticipantID sql.NullString
	err := r.db.QueryRow(`
		SELECT sl.id, sl.event_id, sl.token, sl.label, sl.created_at,
		       isl.name, isl.participant_id
		FROM share_links sl
		LEFT JOIN individual_share_links isl ON isl.share_link_id = sl.id
		WHERE sl.token = ?`, token,
	).Scan(&link.ID, &link.EventID, &link.Token, &link.Label, &createdAt,
		&indName, &indParticipantID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	link.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, err
	}
	if indName.Valid {
		link.Kind = domain.IndividualShareLinkKind{Name: indName.String, ParticipantID: indParticipantID.String}
	} else {
		link.Kind = domain.GlobalShareLinkKind{}
	}
	return &link, nil
}

func (r *SQLiteShareLinkRepo) GetByEventID(eventID string) ([]domain.ShareLink, error) {
	rows, err := r.db.Query(`
		SELECT sl.id, sl.event_id, sl.token, sl.label, sl.created_at,
		       isl.name, isl.participant_id
		FROM share_links sl
		LEFT JOIN individual_share_links isl ON isl.share_link_id = sl.id
		WHERE sl.event_id = ?`, eventID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var links []domain.ShareLink
	for rows.Next() {
		var link domain.ShareLink
		var createdAt string
		var indName, indParticipantID sql.NullString
		if err := rows.Scan(&link.ID, &link.EventID, &link.Token, &link.Label, &createdAt,
			&indName, &indParticipantID); err != nil {
			return nil, err
		}
		link.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, err
		}
		if indName.Valid {
			link.Kind = domain.IndividualShareLinkKind{Name: indName.String, ParticipantID: indParticipantID.String}
		} else {
			link.Kind = domain.GlobalShareLinkKind{}
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (r *SQLiteShareLinkRepo) Delete(id string, eventID string) error {
	_, err := r.db.Exec(
		`DELETE FROM share_links WHERE id = ? AND event_id = ?`, id, eventID,
	)
	return err
}
