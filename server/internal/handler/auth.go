package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/pennane/availability/server/internal/domain"
	"github.com/pennane/availability/server/internal/repository"
)

type contextKey string

const (
	ctxRole        contextKey = "role"
	ctxParticipant contextKey = "participant"
	ctxEventID     contextKey = "eventID"
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
		return RoleHost, nil
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

func withRole(ctx context.Context, role Role) context.Context {
	return context.WithValue(ctx, ctxRole, role)
}

func withParticipant(ctx context.Context, p *domain.Participant) context.Context {
	return context.WithValue(ctx, ctxParticipant, p)
}

func roleFromCtx(ctx context.Context) Role {
	r, _ := ctx.Value(ctxRole).(Role)
	return r
}

func participantFromCtx(ctx context.Context) *domain.Participant {
	p, _ := ctx.Value(ctxParticipant).(*domain.Participant)
	return p
}
