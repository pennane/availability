package app

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/pennane/availability/server/internal/cleanup"
	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/handler"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

type Config struct {
	Port          string
	DBPath        string
	AllowedOrigin string
}

func Run(ctx context.Context, cfg Config) error {
	database, err := db.New(cfg.DBPath)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		return err
	}

	h := handler.New(
		database,
		repository.NewSQLiteEventRepo(database),
		repository.NewSQLiteParticipantRepo(database),
		repository.NewSQLiteEventDateRepo(database),
		repository.NewSQLiteAvailabilityRepo(database),
		repository.NewSQLiteShareLinkRepo(database),
		ws.NewBroadcast(),
	)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.AllowedOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.Mount("/", h.Routes())

	go cleanup.Run(ctx, database)

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("listening on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	log.Println("server stopped")
	return nil
}
