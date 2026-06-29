package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

type Handler struct {
	events       repository.EventRepository
	participants repository.ParticipantRepository
	dates        repository.EventDateRepository
	availability repository.AvailabilityRepository
	shareLinks   repository.ShareLinkRepository
	auth         *AuthResolver
	broadcast    *ws.Broadcast
}

func New(
	events repository.EventRepository,
	participants repository.ParticipantRepository,
	dates repository.EventDateRepository,
	availability repository.AvailabilityRepository,
	shareLinks repository.ShareLinkRepository,
	broadcast *ws.Broadcast,
) *Handler {
	return &Handler{
		events:       events,
		participants: participants,
		dates:        dates,
		availability: availability,
		shareLinks:   shareLinks,
		auth:         NewAuthResolver(events, participants),
		broadcast:    broadcast,
	}
}

func (h *Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Timezone    string `json:"timezone"`
		TimeSlotConfig struct {
			DurationMinutes int    `json:"durationMinutes"`
			RangeStart      string `json:"rangeStart"`
			RangeEnd        string `json:"rangeEnd"`
		} `json:"timeSlotConfig"`
		Visibility  json.RawMessage `json:"visibility"`
		Suggestions json.RawMessage `json:"suggestions"`
		Dates       []string        `json:"dates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	visibility, err := parseVisibility(req.Visibility)
	if err != nil {
		http.Error(w, "invalid visibility", http.StatusBadRequest)
		return
	}

	suggestions, err := parseSuggestionPolicy(req.Suggestions)
	if err != nil {
		http.Error(w, "invalid suggestion policy", http.StatusBadRequest)
		return
	}

	event := domain.Event{
		ID:          domain.NewID(),
		Title:       req.Title,
		Description: req.Description,
		HostToken:   domain.NewToken(),
		Timezone:    req.Timezone,
		TimeSlotConfig: domain.TimeSlotConfig{
			DurationMinutes: req.TimeSlotConfig.DurationMinutes,
			RangeStart:      req.TimeSlotConfig.RangeStart,
			RangeEnd:        req.TimeSlotConfig.RangeEnd,
		},
		Visibility:  visibility,
		Suggestions: suggestions,
		CreatedAt:   time.Now(),
	}

	for _, d := range req.Dates {
		event.Dates = append(event.Dates, domain.EventDate{
			ID:      domain.NewID(),
			EventID: event.ID,
			Date:    d,
			Origin:  domain.HostSuggestedOrigin{},
		})
	}

	if err := h.events.Create(event); err != nil {
		http.Error(w, "failed to create event", http.StatusInternalServerError)
		return
	}

	hostParticipant := domain.Participant{
		ID:      domain.NewID(),
		EventID: event.ID,
		Name:    "Host",
		Token:   event.HostToken,
	}
	if err := h.participants.Create(hostParticipant); err != nil {
		http.Error(w, "failed to create host participant", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"eventId":   event.ID,
		"hostToken": event.HostToken,
	})
}

func (h *Handler) GetEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	event, err := h.events.GetByID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	role, _ := h.auth.Resolve(r, eventID)
	dates, _ := h.dates.GetByEventID(eventID)
	event.Dates = dates

	var response any
	switch role {
	case RoleHost, RoleParticipant:
		participants, _ := h.participants.GetByEventID(eventID)
		allAvail, _ := h.availability.GetByEventID(eventID)
		if role == RoleHost {
			links, _ := h.shareLinks.GetByEventID(eventID)
			response = buildHostView(event, participants, allAvail, links)
		} else {
			response = buildParticipantView(event, participants, allAvail)
		}
	default:
		response = buildPublicView(event)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) JoinEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	event, err := h.events.GetByID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var req struct {
		Name       string `json:"name"`
		ShareToken string `json:"shareToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.ShareToken == "" {
		http.Error(w, "shareToken is required", http.StatusBadRequest)
		return
	}

	link, err := h.shareLinks.GetByToken(req.ShareToken)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if link == nil || link.EventID != eventID {
		http.Error(w, "invalid invite link", http.StatusForbidden)
		return
	}

	p := domain.Participant{
		ID:      domain.NewID(),
		EventID: eventID,
		Name:    req.Name,
		Token:   domain.NewToken(),
	}

	if err := h.participants.Create(p); err != nil {
		http.Error(w, "failed to join event", http.StatusInternalServerError)
		return
	}

	h.broadcast.Send(eventID, ws.EventMessage{
		Kind:          "participant-joined",
		ParticipantID: p.ID,
		Name:          p.Name,
	}, nil)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"participantId": p.ID,
		"token":         p.Token,
	})
}

func (h *Handler) GetMyParticipation(w http.ResponseWriter, r *http.Request, eventID string) {
	role, participant := h.auth.Resolve(r, eventID)
	if (role != RoleParticipant && role != RoleHost) || participant == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	avail, err := h.availability.GetByParticipantID(participant.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	availMaps := make([]map[string]any, len(avail))
	for i, e := range avail {
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
		availMaps[i] = m
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":           participant.ID,
		"name":         participant.Name,
		"note":         participant.Note,
		"availability": availMaps,
	})
}

func (h *Handler) UpdateMyParticipation(w http.ResponseWriter, r *http.Request, eventID string) {
	role, participant := h.auth.Resolve(r, eventID)
	if (role != RoleParticipant && role != RoleHost) || participant == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Name *string `json:"name"`
		Note *string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.participants.Update(participant.ID, req.Name, req.Note); err != nil {
		http.Error(w, "failed to update participation", http.StatusInternalServerError)
		return
	}

	// Fetch updated participant
	updated, err := h.participants.GetByToken(participant.Token)
	if err != nil || updated == nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	avail, err := h.availability.GetByParticipantID(updated.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	availMaps := make([]map[string]any, len(avail))
	for i, e := range avail {
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
		availMaps[i] = m
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":           updated.ID,
		"name":         updated.Name,
		"note":         updated.Note,
		"availability": availMaps,
	})
}

func (h *Handler) ReplaceAvailability(w http.ResponseWriter, r *http.Request, eventID string) {
	role, participant := h.auth.Resolve(r, eventID)
	if (role != RoleParticipant && role != RoleHost) || participant == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Entries []struct {
			EventDateID string `json:"eventDateId"`
			Slot        string `json:"slot"`
			Kind        string `json:"kind"`
			Reason      string `json:"reason"`
		} `json:"entries"`
		Nonce string `json:"nonce,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	entries := make([]domain.AvailabilityEntry, len(req.Entries))
	for i, e := range req.Entries {
		var kind domain.AvailabilityKind
		switch e.Kind {
		case "available":
			kind = domain.AvailableKind{}
		case "if-needed":
			kind = domain.IfNeededKind{Reason: e.Reason}
		default:
			http.Error(w, fmt.Sprintf("unknown availability kind: %s", e.Kind), http.StatusBadRequest)
			return
		}
		entries[i] = domain.AvailabilityEntry{
			ID:          domain.NewID(),
			EventDateID: e.EventDateID,
			Slot:        e.Slot,
			Kind:        kind,
		}
	}

	if err := h.availability.ReplaceForParticipant(participant.ID, eventID, entries); err != nil {
		http.Error(w, "failed to replace availability", http.StatusInternalServerError)
		return
	}

	h.broadcast.Send(eventID, ws.EventMessage{
		Kind:          "availability-updated",
		ParticipantID: participant.ID,
		Nonce:         req.Nonce,
	}, nil)

	avail, err := h.availability.GetByParticipantID(participant.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	availMaps := make([]map[string]any, len(avail))
	for i, e := range avail {
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
		availMaps[i] = m
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":           participant.ID,
		"name":         participant.Name,
		"note":         participant.Note,
		"availability": availMaps,
	})
}

func (h *Handler) UpdateEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Title       *string         `json:"title"`
		Description *string         `json:"description"`
		Visibility  json.RawMessage `json:"visibility"`
		Suggestions json.RawMessage `json:"suggestions"`
		// Explicitly reject immutable fields
		Timezone       *string `json:"timezone"`
		TimeSlotConfig *struct{} `json:"timeSlotConfig"`
		Dates          *[]string `json:"dates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Timezone != nil || req.TimeSlotConfig != nil || req.Dates != nil {
		http.Error(w, "timezone, timeSlotConfig, and dates are immutable", http.StatusBadRequest)
		return
	}

	var visibility domain.VisibilityPolicy
	if req.Visibility != nil {
		v, err := parseVisibility(req.Visibility)
		if err != nil {
			http.Error(w, "invalid visibility", http.StatusBadRequest)
			return
		}
		visibility = v
	}

	var suggestions domain.SuggestionPolicy
	if req.Suggestions != nil {
		s, err := parseSuggestionPolicy(req.Suggestions)
		if err != nil {
			http.Error(w, "invalid suggestion policy", http.StatusBadRequest)
			return
		}
		suggestions = s
	}

	if err := h.events.UpdateMutable(eventID, req.Title, req.Description, visibility, suggestions); err != nil {
		http.Error(w, "failed to update event", http.StatusInternalServerError)
		return
	}

	h.broadcast.Send(eventID, ws.EventMessage{Kind: "settings-changed"}, nil)

	event, err := h.events.GetByID(eventID)
	if err != nil || event == nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	dates, _ := h.dates.GetByEventID(eventID)
	event.Dates = dates

	links, _ := h.shareLinks.GetByEventID(eventID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buildHostView(event, nil, nil, links))
}

func (h *Handler) SuggestDate(w http.ResponseWriter, r *http.Request, eventID string) {
	event, err := h.events.GetByID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	role, participant := h.auth.Resolve(r, eventID)
	if role == RoleAnonymous {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Check suggestion policy is open
	if _, ok := event.Suggestions.(domain.OpenSuggestionPolicy); !ok {
		http.Error(w, "suggestions are closed", http.StatusForbidden)
		return
	}

	var req struct {
		Date string `json:"date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Date == "" {
		http.Error(w, "date is required", http.StatusBadRequest)
		return
	}

	// Check for existing date
	existing, err := h.dates.GetByEventIDAndDate(eventID, req.Date)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if existing != nil {
		http.Error(w, "date already exists", http.StatusConflict)
		return
	}

	var origin domain.EventDateOrigin
	if role == RoleHost {
		origin = domain.HostSuggestedOrigin{}
	} else {
		origin = domain.ParticipantSuggestedOrigin{ParticipantID: participant.ID}
	}

	newDate := domain.EventDate{
		ID:      domain.NewID(),
		EventID: eventID,
		Date:    req.Date,
		Origin:  origin,
	}

	if err := h.dates.Create(newDate); err != nil {
		http.Error(w, "failed to create date", http.StatusInternalServerError)
		return
	}

	h.broadcast.Send(eventID, ws.EventMessage{
		Kind:        "date-suggested",
		EventDateID: newDate.ID,
		Date:        newDate.Date,
	}, nil)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	dateMap := map[string]any{"id": newDate.ID, "date": newDate.Date}
	switch o := newDate.Origin.(type) {
	case domain.HostSuggestedOrigin:
		dateMap["origin"] = "host"
	case domain.ParticipantSuggestedOrigin:
		dateMap["origin"] = "participant"
		dateMap["participantId"] = o.ParticipantID
	}
	json.NewEncoder(w).Encode(dateMap)
}

func (h *Handler) RemoveParticipant(w http.ResponseWriter, r *http.Request, eventID string, participantID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if err := h.participants.Delete(participantID, eventID); err != nil {
		http.Error(w, "failed to remove participant", http.StatusInternalServerError)
		return
	}

	h.broadcast.Send(eventID, ws.EventMessage{
		Kind:          "participant-removed",
		ParticipantID: participantID,
	}, nil)

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CreateShareLink(w http.ResponseWriter, r *http.Request, eventID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Label string `json:"label"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	link := domain.ShareLink{
		ID:        domain.NewID(),
		EventID:   eventID,
		Token:     domain.NewToken(),
		Label:     req.Label,
		CreatedAt: time.Now(),
	}

	if err := h.shareLinks.Create(link); err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"id":        link.ID,
		"token":     link.Token,
		"label":     link.Label,
		"createdAt": link.CreatedAt.Format(time.RFC3339),
	})
}

func (h *Handler) ListShareLinks(w http.ResponseWriter, r *http.Request, eventID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	links, err := h.shareLinks.GetByEventID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"links": buildShareLinks(links),
	})
}

func (h *Handler) DeleteShareLink(w http.ResponseWriter, r *http.Request, eventID string, linkID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if err := h.shareLinks.Delete(linkID, eventID); err != nil {
		http.Error(w, "failed to delete share link", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ValidateShareToken(w http.ResponseWriter, r *http.Request, eventID string, token string) {
	link, err := h.shareLinks.GetByToken(token)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if link == nil || link.EventID != eventID {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	event, err := h.events.GetByID(eventID)
	if err != nil || event == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid":       true,
		"title":       event.Title,
		"description": event.Description,
	})
}

func parseVisibility(raw json.RawMessage) (domain.VisibilityPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "names-visible":
		return domain.NamesVisibleVisibility{}, nil
	case "anonymous":
		return domain.AnonymousVisibility{}, nil
	default:
		return nil, fmt.Errorf("unknown visibility kind: %s", v.Kind)
	}
}

func parseSuggestionPolicy(raw json.RawMessage) (domain.SuggestionPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "open":
		return domain.OpenSuggestionPolicy{}, nil
	case "closed":
		return domain.ClosedSuggestionPolicy{}, nil
	default:
		return nil, fmt.Errorf("unknown suggestion policy kind: %s", v.Kind)
	}
}

// View builders — these construct the polymorphic response shapes

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
		result[i] = map[string]any{
			"id":        l.ID,
			"token":     l.Token,
			"label":     l.Label,
			"createdAt": l.CreatedAt.Format(time.RFC3339),
		}
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
		avail := make([]map[string]any, len(entries))
		for j, e := range entries {
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
			avail[j] = m
		}
		result[i] = map[string]any{
			"id":           p.ID,
			"name":         p.Name,
			"note":         p.Note,
			"availability": avail,
		}
	}
	return result
}
