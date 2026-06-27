package domain

type AvailabilityKind interface {
	availabilityKind()
}

type AvailableKind struct{}
type IfNeededKind struct {
	Reason string
}

func (AvailableKind) availabilityKind() {}
func (IfNeededKind) availabilityKind()  {}

type AvailabilityEntry struct {
	ID          string
	EventDateID string
	Slot        string // full ISO datetime, e.g. 2026-07-15T22:00
	Kind        AvailabilityKind
}
