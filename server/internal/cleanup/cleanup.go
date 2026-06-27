package cleanup

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// expiredEventsSQL selects IDs of events that are past their TTL:
//   - Events with dates: expired when the most-recent date is >14 days ago.
//   - Events without dates: expired when created_at is >60 days ago.
const expiredEventsSQL = `
SELECT e.id FROM events e
LEFT JOIN event_dates ed ON ed.event_id = e.id
GROUP BY e.id
HAVING
	(MAX(ed.date) IS NOT NULL AND MAX(ed.date) < date('now', '-14 days'))
	OR
	(MAX(ed.date) IS NULL AND e.created_at < datetime('now', '-60 days'))`

// deleteAvailabilitySQL removes availability rows that belong to expired events.
// availability has FK references to participants and event_dates without ON DELETE CASCADE,
// so we must delete it explicitly before the parent event rows are removed.
const deleteAvailabilitySQL = `
DELETE FROM availability WHERE event_id IN (` + expiredEventsSQL + `)`

const deleteExpiredSQL = `
DELETE FROM events WHERE id IN (` + expiredEventsSQL + `)`

func DeleteExpired(db *sql.DB) (int64, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(deleteAvailabilitySQL); err != nil {
		return 0, err
	}

	res, err := tx.Exec(deleteExpiredSQL)
	if err != nil {
		return 0, err
	}

	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	return n, nil
}

func Run(ctx context.Context, db *sql.DB) {
	run := func() {
		n, err := DeleteExpired(db)
		if err != nil {
			log.Printf("cleanup: error deleting expired events: %v", err)
			return
		}
		if n > 0 {
			log.Printf("cleanup: deleted %d expired event(s)", n)
		}
	}

	run()

	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
