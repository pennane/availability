package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/ws"
)

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
	if _, ok := link.Kind.(domain.IndividualShareLinkKind); ok {
		http.Error(w, "individual links cannot be used to join", http.StatusBadRequest)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buildParticipantResponse(participant, avail))
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buildParticipantResponse(updated, avail))
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buildParticipantResponse(participant, avail))
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
