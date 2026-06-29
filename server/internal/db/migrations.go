package db

import "database/sql"

func Migrate(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS events (
	id                    TEXT PRIMARY KEY,
	title                 TEXT NOT NULL,
	host_token            TEXT NOT NULL UNIQUE,
	description           TEXT DEFAULT '',
	timezone              TEXT NOT NULL,
	slot_duration_minutes INTEGER NOT NULL CHECK(slot_duration_minutes IN (15, 30, 60)),
	time_range_start      TEXT NOT NULL,
	time_range_end        TEXT NOT NULL,
	created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS names_visible_visibility (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS anonymous_visibility (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_names_visible_excl
BEFORE INSERT ON names_visible_visibility
BEGIN
	SELECT RAISE(ABORT, 'event already has anonymous visibility')
	WHERE EXISTS (SELECT 1 FROM anonymous_visibility WHERE event_id = NEW.event_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_excl
BEFORE INSERT ON anonymous_visibility
BEGIN
	SELECT RAISE(ABORT, 'event already has names-visible visibility')
	WHERE EXISTS (SELECT 1 FROM names_visible_visibility WHERE event_id = NEW.event_id);
END;

CREATE TABLE IF NOT EXISTS open_suggestion_policy (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS closed_suggestion_policy (
	event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_open_suggestion_excl
BEFORE INSERT ON open_suggestion_policy
BEGIN
	SELECT RAISE(ABORT, 'event already has closed suggestion policy')
	WHERE EXISTS (SELECT 1 FROM closed_suggestion_policy WHERE event_id = NEW.event_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_closed_suggestion_excl
BEFORE INSERT ON closed_suggestion_policy
BEGIN
	SELECT RAISE(ABORT, 'event already has open suggestion policy')
	WHERE EXISTS (SELECT 1 FROM open_suggestion_policy WHERE event_id = NEW.event_id);
END;

CREATE TABLE IF NOT EXISTS participants (
	id       TEXT PRIMARY KEY,
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	name     TEXT NOT NULL,
	token    TEXT NOT NULL UNIQUE,
	note     TEXT DEFAULT '',
	UNIQUE(id, event_id)
);

CREATE TABLE IF NOT EXISTS event_dates (
	id       TEXT PRIMARY KEY,
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	date     TEXT NOT NULL,
	UNIQUE(event_id, date),
	UNIQUE(id, event_id)
);

CREATE TABLE IF NOT EXISTS host_suggested_dates (
	event_date_id TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participant_suggested_dates (
	event_date_id  TEXT PRIMARY KEY REFERENCES event_dates(id) ON DELETE CASCADE,
	participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_host_date_excl
BEFORE INSERT ON host_suggested_dates
BEGIN
	SELECT RAISE(ABORT, 'date already suggested by participant')
	WHERE EXISTS (SELECT 1 FROM participant_suggested_dates WHERE event_date_id = NEW.event_date_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_participant_date_excl
BEFORE INSERT ON participant_suggested_dates
BEGIN
	SELECT RAISE(ABORT, 'date already suggested by host')
	WHERE EXISTS (SELECT 1 FROM host_suggested_dates WHERE event_date_id = NEW.event_date_id);
END;

CREATE TABLE IF NOT EXISTS availability (
	id             TEXT PRIMARY KEY,
	participant_id TEXT NOT NULL,
	event_date_id  TEXT NOT NULL,
	event_id       TEXT NOT NULL,
	slot           TEXT NOT NULL,
	UNIQUE(participant_id, event_date_id, slot),
	FOREIGN KEY (participant_id, event_id) REFERENCES participants(id, event_id),
	FOREIGN KEY (event_date_id, event_id) REFERENCES event_dates(id, event_id)
);

CREATE TABLE IF NOT EXISTS available_availability (
	availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS if_needed_availability (
	availability_id TEXT PRIMARY KEY REFERENCES availability(id) ON DELETE CASCADE,
	reason          TEXT DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS trg_available_excl
BEFORE INSERT ON available_availability
BEGIN
	SELECT RAISE(ABORT, 'availability already marked as if-needed')
	WHERE EXISTS (SELECT 1 FROM if_needed_availability WHERE availability_id = NEW.availability_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_if_needed_excl
BEFORE INSERT ON if_needed_availability
BEGIN
	SELECT RAISE(ABORT, 'availability already marked as available')
	WHERE EXISTS (SELECT 1 FROM available_availability WHERE availability_id = NEW.availability_id);
END;

CREATE INDEX IF NOT EXISTS idx_availability_event_date_id ON availability(event_date_id);
CREATE INDEX IF NOT EXISTS idx_availability_event_id ON availability(event_id);
CREATE INDEX IF NOT EXISTS idx_event_dates_event_id ON event_dates(event_id);
CREATE INDEX IF NOT EXISTS idx_participants_event_id ON participants(event_id);

CREATE TABLE IF NOT EXISTS share_links (
	id TEXT PRIMARY KEY,
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	token TEXT NOT NULL UNIQUE,
	label TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_links_event_id ON share_links(event_id);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);

CREATE TABLE IF NOT EXISTS global_share_links (
	share_link_id TEXT PRIMARY KEY REFERENCES share_links(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS individual_share_links (
	share_link_id  TEXT PRIMARY KEY REFERENCES share_links(id) ON DELETE CASCADE,
	name           TEXT NOT NULL,
	participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_global_share_link_excl
BEFORE INSERT ON global_share_links
BEGIN
	SELECT RAISE(ABORT, 'share link already has individual kind')
	WHERE EXISTS (SELECT 1 FROM individual_share_links WHERE share_link_id = NEW.share_link_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_individual_share_link_excl
BEFORE INSERT ON individual_share_links
BEGIN
	SELECT RAISE(ABORT, 'share link already has global kind')
	WHERE EXISTS (SELECT 1 FROM global_share_links WHERE share_link_id = NEW.share_link_id);
END;

INSERT OR IGNORE INTO global_share_links (share_link_id)
SELECT id FROM share_links
WHERE id NOT IN (SELECT share_link_id FROM global_share_links)
  AND id NOT IN (SELECT share_link_id FROM individual_share_links);
`
