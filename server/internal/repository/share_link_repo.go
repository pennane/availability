package repository

import (
	"database/sql"
	"time"

	"github.com/pennane/availability/server/internal/domain"
)

type ShareLinkRepository interface {
	Create(link domain.ShareLink) error
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
	_, err := r.db.Exec(
		`INSERT INTO share_links (id, event_id, token, label, created_at) VALUES (?, ?, ?, ?, ?)`,
		link.ID, link.EventID, link.Token, link.Label, link.CreatedAt.Format(time.RFC3339),
	)
	return err
}

func (r *SQLiteShareLinkRepo) GetByToken(token string) (*domain.ShareLink, error) {
	var link domain.ShareLink
	var createdAt string
	err := r.db.QueryRow(
		`SELECT id, event_id, token, label, created_at FROM share_links WHERE token = ?`, token,
	).Scan(&link.ID, &link.EventID, &link.Token, &link.Label, &createdAt)
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
	link.Kind = domain.GlobalShareLinkKind{}
	return &link, nil
}

func (r *SQLiteShareLinkRepo) GetByEventID(eventID string) ([]domain.ShareLink, error) {
	rows, err := r.db.Query(
		`SELECT id, event_id, token, label, created_at FROM share_links WHERE event_id = ?`, eventID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var links []domain.ShareLink
	for rows.Next() {
		var link domain.ShareLink
		var createdAt string
		if err := rows.Scan(&link.ID, &link.EventID, &link.Token, &link.Label, &createdAt); err != nil {
			return nil, err
		}
		link.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, err
		}
		link.Kind = domain.GlobalShareLinkKind{}
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
