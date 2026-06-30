package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/ws"
)

func (h *Handler) CreateShareLink(w http.ResponseWriter, r *http.Request, eventID string) {
	role, _ := h.auth.Resolve(r, eventID)
	if role != RoleHost {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Kind  string `json:"kind"`
		Label string `json:"label"`
		Name  string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.Kind == "" {
		req.Kind = "global"
	}

	link := domain.ShareLink{
		ID:        domain.NewID(),
		EventID:   eventID,
		Token:     domain.NewToken(),
		Label:     req.Label,
		CreatedAt: time.Now(),
	}

	switch req.Kind {
	case "global":
		link.Kind = domain.GlobalShareLinkKind{}
		if err := h.shareLinks.Create(link); err != nil {
			http.Error(w, "failed to create share link", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"id": link.ID, "token": link.Token, "label": link.Label,
			"createdAt": link.CreatedAt.Format(time.RFC3339), "kind": "global",
		})

	case "individual":
		if req.Name == "" {
			http.Error(w, "name is required for individual links", http.StatusBadRequest)
			return
		}
		if len(req.Name) > 100 {
			http.Error(w, "name too long", http.StatusBadRequest)
			return
		}

		participant := domain.Participant{
			ID:      domain.NewID(),
			EventID: eventID,
			Name:    req.Name,
			Token:   domain.NewToken(),
		}

		tx, err := h.db.Begin()
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec(
			`INSERT INTO participants (id, event_id, name, token, note) VALUES (?, ?, ?, ?, ?)`,
			participant.ID, participant.EventID, participant.Name, participant.Token, participant.Note,
		)
		if err != nil {
			http.Error(w, "failed to create participant", http.StatusInternalServerError)
			return
		}

		link.Kind = domain.IndividualShareLinkKind{
			Name:          req.Name,
			ParticipantID: participant.ID,
		}
		if err := h.shareLinks.CreateWithKind(tx, link); err != nil {
			http.Error(w, "failed to create share link", http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		h.broadcast.Send(eventID, ws.EventMessage{
			Kind:          "participant-joined",
			ParticipantID: participant.ID,
			Name:          participant.Name,
		}, nil)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"id": link.ID, "token": link.Token, "label": link.Label,
			"createdAt": link.CreatedAt.Format(time.RFC3339), "kind": "individual",
			"name": req.Name, "participantId": participant.ID,
		})

	default:
		http.Error(w, "invalid kind: must be global or individual", http.StatusBadRequest)
	}
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

	resp := map[string]any{
		"valid": true,
		"title": event.Title,
	}
	if event.Description != "" {
		resp["description"] = event.Description
	}

	switch k := link.Kind.(type) {
	case domain.IndividualShareLinkKind:
		participant, err := h.participants.GetByID(k.ParticipantID)
		if err != nil || participant == nil {
			http.Error(w, "participant no longer exists", http.StatusNotFound)
			return
		}
		resp["kind"] = "individual"
		resp["name"] = k.Name
		resp["participantToken"] = participant.Token
	default:
		resp["kind"] = "global"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
