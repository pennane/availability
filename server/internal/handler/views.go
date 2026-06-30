package handler

import (
	"time"

	"github.com/pennane/availability/server/internal/domain"
)

func serializeAvailability(entries []domain.AvailabilityEntry) []map[string]any {
	result := make([]map[string]any, len(entries))
	for i, e := range entries {
		m := map[string]any{"eventDateId": e.EventDateID, "slot": e.Slot}
		switch k := e.Kind.(type) {
		case domain.AvailableKind:
			m["kind"] = "available"
		case domain.IfNeededKind:
			m["kind"] = "if-needed"
			if k.Reason != "" {
				m["reason"] = k.Reason
			}
		}
		result[i] = m
	}
	return result
}

func buildParticipantResponse(p *domain.Participant, avail []domain.AvailabilityEntry) map[string]any {
	return map[string]any{
		"id":           p.ID,
		"name":         p.Name,
		"note":         p.Note,
		"availability": serializeAvailability(avail),
	}
}

func buildPublicView(event *domain.Event) map[string]any {
	return map[string]any{
		"role":           "public",
		"id":             event.ID,
		"title":          event.Title,
		"description":    event.Description,
		"timezone":       event.Timezone,
		"timeSlotConfig": buildTimeSlotConfig(event.TimeSlotConfig),
		"dates":          buildDates(event.Dates),
	}
}

func buildHostView(event *domain.Event, participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry, links []domain.ShareLink) map[string]any {
	view := buildPublicView(event)
	view["role"] = "host"
	view["visibility"] = buildVisibility(event.Visibility)
	view["suggestions"] = buildSuggestionPolicy(event.Suggestions)
	view["participants"] = buildParticipantsWithAvailability(participants, allAvail)
	view["shareLinks"] = buildShareLinks(links)
	return view
}

func buildParticipantView(event *domain.Event, participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry) map[string]any {
	view := buildPublicView(event)
	view["role"] = "participant"
	view["visibility"] = buildVisibility(event.Visibility)
	view["suggestions"] = buildSuggestionPolicy(event.Suggestions)
	view["participants"] = buildParticipantsWithAvailability(participants, allAvail)
	return view
}

func buildTimeSlotConfig(c domain.TimeSlotConfig) map[string]any {
	return map[string]any{
		"durationMinutes": c.DurationMinutes,
		"rangeStart":      c.RangeStart,
		"rangeEnd":        c.RangeEnd,
	}
}

func buildVisibility(v domain.VisibilityPolicy) map[string]any {
	switch v.(type) {
	case domain.NamesVisibleVisibility:
		return map[string]any{"kind": "names-visible"}
	case domain.AnonymousVisibility:
		return map[string]any{"kind": "anonymous"}
	default:
		return nil
	}
}

func buildSuggestionPolicy(s domain.SuggestionPolicy) map[string]any {
	switch s.(type) {
	case domain.OpenSuggestionPolicy:
		return map[string]any{"kind": "open"}
	case domain.ClosedSuggestionPolicy:
		return map[string]any{"kind": "closed"}
	default:
		return nil
	}
}

func buildDates(dates []domain.EventDate) []map[string]any {
	result := make([]map[string]any, len(dates))
	for i, d := range dates {
		m := map[string]any{"id": d.ID, "date": d.Date}
		switch o := d.Origin.(type) {
		case domain.HostSuggestedOrigin:
			m["origin"] = "host"
		case domain.ParticipantSuggestedOrigin:
			m["origin"] = "participant"
			m["participantId"] = o.ParticipantID
		}
		result[i] = m
	}
	return result
}

func buildShareLinks(links []domain.ShareLink) []map[string]any {
	result := make([]map[string]any, len(links))
	for i, l := range links {
		m := map[string]any{
			"id":        l.ID,
			"token":     l.Token,
			"label":     l.Label,
			"createdAt": l.CreatedAt.Format(time.RFC3339),
		}
		switch k := l.Kind.(type) {
		case domain.IndividualShareLinkKind:
			m["kind"] = "individual"
			m["name"] = k.Name
			m["participantId"] = k.ParticipantID
		default:
			m["kind"] = "global"
		}
		result[i] = m
	}
	return result
}

func buildParticipantsWithAvailability(participants []domain.Participant, allAvail map[string][]domain.AvailabilityEntry) []map[string]any {
	result := make([]map[string]any, len(participants))
	for i, p := range participants {
		var entries []domain.AvailabilityEntry
		if allAvail != nil {
			entries = allAvail[p.ID]
		}
		result[i] = buildParticipantResponse(&p, entries)
	}
	return result
}
