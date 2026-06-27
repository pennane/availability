package domain

type EventDateOrigin interface {
	eventDateOrigin()
}

type HostSuggestedOrigin struct{}
type ParticipantSuggestedOrigin struct {
	ParticipantID string
}

func (HostSuggestedOrigin) eventDateOrigin()        {}
func (ParticipantSuggestedOrigin) eventDateOrigin() {}

type EventDate struct {
	ID      string
	EventID string
	Date    string // YYYY-MM-DD
	Origin  EventDateOrigin
}
