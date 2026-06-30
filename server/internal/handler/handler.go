package handler

import (
	"database/sql"

	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

type Handler struct {
	db           *sql.DB
	events       repository.EventRepository
	participants repository.ParticipantRepository
	dates        repository.EventDateRepository
	availability repository.AvailabilityRepository
	shareLinks   repository.ShareLinkRepository
	auth         *AuthResolver
	broadcast    *ws.Broadcast
}

func New(
	db *sql.DB,
	events repository.EventRepository,
	participants repository.ParticipantRepository,
	dates repository.EventDateRepository,
	availability repository.AvailabilityRepository,
	shareLinks repository.ShareLinkRepository,
	broadcast *ws.Broadcast,
) *Handler {
	return &Handler{
		db:           db,
		events:       events,
		participants: participants,
		dates:        dates,
		availability: availability,
		shareLinks:   shareLinks,
		auth:         NewAuthResolver(events, participants),
		broadcast:    broadcast,
	}
}
