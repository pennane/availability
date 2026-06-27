package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/pennane/availability/server/internal/ws"
)

func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request, eventID string) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// Create a synthetic request with the token as a Bearer header so auth.Resolve works normally.
	authReq, _ := http.NewRequest(http.MethodGet, "/", nil)
	authReq.Header.Set("Authorization", "Bearer "+token)
	role, _ := h.auth.Resolve(authReq, eventID)
	if role == RoleAnonymous {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	client := &ws.Client{Send: make(chan []byte, 16)}
	h.broadcast.Subscribe(eventID, client)
	defer h.broadcast.Unsubscribe(eventID, client)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Read pump — detects client disconnect.
	go func() {
		for {
			_, _, err := conn.Read(ctx)
			if err != nil {
				cancel()
				return
			}
		}
	}()

	// Write pump — forwards broadcast messages to the WebSocket connection.
	for {
		select {
		case msg, ok := <-client.Send:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(writeCtx, websocket.MessageText, msg)
			writeCancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
