package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/pennane/availability/server/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := app.Run(ctx, app.Config{
		Port:          envOr("PORT", "8080"),
		DBPath:        envOr("DATABASE_PATH", "./availability.db"),
		AllowedOrigin: envOr("ALLOWED_ORIGIN", "http://localhost:5173"),
	}); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
