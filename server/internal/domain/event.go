package domain

import "time"

type VisibilityPolicy interface {
	visibilityPolicy()
}

type NamesVisibleVisibility struct{}
type AnonymousVisibility struct{}

func (NamesVisibleVisibility) visibilityPolicy() {}
func (AnonymousVisibility) visibilityPolicy()    {}

type SuggestionPolicy interface {
	suggestionPolicy()
}

type OpenSuggestionPolicy struct{}
type ClosedSuggestionPolicy struct{}

func (OpenSuggestionPolicy) suggestionPolicy()   {}
func (ClosedSuggestionPolicy) suggestionPolicy() {}

type TimeSlotConfig struct {
	DurationMinutes int
	RangeStart      string // HH:mm
	RangeEnd        string // HH:mm
}

type Event struct {
	ID             string
	Title          string
	Description    string
	HostToken      string
	Timezone       string
	TimeSlotConfig TimeSlotConfig
	Visibility     VisibilityPolicy
	Suggestions    SuggestionPolicy
	Dates          []EventDate
	CreatedAt      time.Time
}

type ShareLinkKind interface {
	shareLinkKind()
}

type GlobalShareLinkKind struct{}
type IndividualShareLinkKind struct {
	Name          string
	ParticipantID string
}

func (GlobalShareLinkKind) shareLinkKind()     {}
func (IndividualShareLinkKind) shareLinkKind() {}

type ShareLink struct {
	ID        string
	EventID   string
	Token     string
	Label     string
	Kind      ShareLinkKind
	CreatedAt time.Time
}
