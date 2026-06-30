package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/events", h.CreateEvent)

	r.Route("/events/{eventId}", func(r chi.Router) {
		eventID := func(r *http.Request) string { return chi.URLParam(r, "eventId") }

		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			h.GetEvent(w, r, eventID(r))
		})
		r.Patch("/", func(w http.ResponseWriter, r *http.Request) {
			h.UpdateEvent(w, r, eventID(r))
		})

		r.Post("/me", func(w http.ResponseWriter, r *http.Request) {
			h.JoinEvent(w, r, eventID(r))
		})
		r.Get("/me", func(w http.ResponseWriter, r *http.Request) {
			h.GetMyParticipation(w, r, eventID(r))
		})
		r.Patch("/me", func(w http.ResponseWriter, r *http.Request) {
			h.UpdateMyParticipation(w, r, eventID(r))
		})
		r.Put("/me/availability", func(w http.ResponseWriter, r *http.Request) {
			h.ReplaceAvailability(w, r, eventID(r))
		})

		r.Post("/dates", func(w http.ResponseWriter, r *http.Request) {
			h.SuggestDate(w, r, eventID(r))
		})

		r.Delete("/participants/{participantId}", func(w http.ResponseWriter, r *http.Request) {
			h.RemoveParticipant(w, r, eventID(r), chi.URLParam(r, "participantId"))
		})

		r.Post("/share-links", func(w http.ResponseWriter, r *http.Request) {
			h.CreateShareLink(w, r, eventID(r))
		})
		r.Get("/share-links", func(w http.ResponseWriter, r *http.Request) {
			h.ListShareLinks(w, r, eventID(r))
		})
		r.Delete("/share-links/{linkId}", func(w http.ResponseWriter, r *http.Request) {
			h.DeleteShareLink(w, r, eventID(r), chi.URLParam(r, "linkId"))
		})

		r.Get("/invite/{token}", func(w http.ResponseWriter, r *http.Request) {
			h.ValidateShareToken(w, r, eventID(r), chi.URLParam(r, "token"))
		})

		r.Get("/live", func(w http.ResponseWriter, r *http.Request) {
			h.HandleWebSocket(w, r, eventID(r))
		})
	})

	return r
}
