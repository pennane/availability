package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/handler"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

func main() {
	port := envOr("PORT", "8080")
	dbPath := envOr("DATABASE_PATH", "./availability.db")
	allowedOrigin := envOr("ALLOWED_ORIGIN", "http://localhost:5173")

	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	eventRepo := repository.NewSQLiteEventRepo(database)
	participantRepo := repository.NewSQLiteParticipantRepo(database)
	dateRepo := repository.NewSQLiteEventDateRepo(database)
	availRepo := repository.NewSQLiteAvailabilityRepo(database)
	broadcast := ws.NewBroadcast()

	h := handler.New(eventRepo, participantRepo, dateRepo, availRepo, broadcast)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{allowedOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.Post("/events", h.CreateEvent)
	r.Get("/events/{eventId}", func(w http.ResponseWriter, r *http.Request) {
		h.GetEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Patch("/events/{eventId}", func(w http.ResponseWriter, r *http.Request) {
		h.UpdateEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Post("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.JoinEvent(w, r, chi.URLParam(r, "eventId"))
	})
	r.Get("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.GetMyParticipation(w, r, chi.URLParam(r, "eventId"))
	})
	r.Patch("/events/{eventId}/me", func(w http.ResponseWriter, r *http.Request) {
		h.UpdateMyParticipation(w, r, chi.URLParam(r, "eventId"))
	})
	r.Put("/events/{eventId}/me/availability", func(w http.ResponseWriter, r *http.Request) {
		h.ReplaceAvailability(w, r, chi.URLParam(r, "eventId"))
	})
	r.Post("/events/{eventId}/dates", func(w http.ResponseWriter, r *http.Request) {
		h.SuggestDate(w, r, chi.URLParam(r, "eventId"))
	})

	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
