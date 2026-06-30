package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/ws"
)

func (h *Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title          string `json:"title"`
		Description    string `json:"description"`
		Timezone       string `json:"timezone"`
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

func (h *Handler) UpdateEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Title          *string         `json:"title"`
		Description    *string         `json:"description"`
		Visibility     json.RawMessage `json:"visibility"`
		Suggestions    json.RawMessage `json:"suggestions"`
		Timezone       *string         `json:"timezone"`
		TimeSlotConfig *struct{}       `json:"timeSlotConfig"`
		Dates          *[]string       `json:"dates"`
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
