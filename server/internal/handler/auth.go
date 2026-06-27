package handler

import (
	"net/http"
	"strings"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

type Role string

const (
	RoleAnonymous   Role = "anonymous"
	RoleHost        Role = "host"
	RoleParticipant Role = "participant"
)

type AuthResolver struct {
	events       repository.EventRepository
	participants repository.ParticipantRepository
}

func NewAuthResolver(events repository.EventRepository, participants repository.ParticipantRepository) *AuthResolver {
	return &AuthResolver{events: events, participants: participants}
}

func (a *AuthResolver) Resolve(r *http.Request, eventID string) (Role, *domain.Participant) {
	token := extractBearerToken(r)
	if token == "" {
		return RoleAnonymous, nil
	}

	event, err := a.events.GetByID(eventID)
	if err != nil || event == nil {
		return RoleAnonymous, nil
	}

	if event.HostToken == token {
		participant, _ := a.participants.GetByToken(token)
		return RoleHost, participant
	}

	participant, err := a.participants.GetByToken(token)
	if err != nil || participant == nil {
		return RoleAnonymous, nil
	}
	if participant.EventID != eventID {
		return RoleAnonymous, nil
	}

	return RoleParticipant, participant
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(auth, "Bearer ")
}

