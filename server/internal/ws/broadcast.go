package ws

import (
	"encoding/json"
	"sync"
)

type EventMessage struct {
	Kind          string `json:"kind"`
	ParticipantID string `json:"participantId,omitempty"`
	Name          string `json:"name,omitempty"`
	EventDateID   string `json:"eventDateId,omitempty"`
	Date          string `json:"date,omitempty"`
	Nonce         string `json:"nonce,omitempty"`
}

type Client struct {
	Send chan []byte
}

type Broadcast struct {
	mu    sync.RWMutex
	rooms map[string]map[*Client]bool // eventID -> clients
}

func NewBroadcast() *Broadcast {
	return &Broadcast{rooms: make(map[string]map[*Client]bool)}
}

func (b *Broadcast) Subscribe(eventID string, client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.rooms[eventID] == nil {
		b.rooms[eventID] = make(map[*Client]bool)
	}
	b.rooms[eventID][client] = true
}

func (b *Broadcast) Unsubscribe(eventID string, client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.rooms[eventID] != nil {
		delete(b.rooms[eventID], client)
		if len(b.rooms[eventID]) == 0 {
			delete(b.rooms, eventID)
		}
	}
}

func (b *Broadcast) Send(eventID string, msg EventMessage, exclude *Client) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	b.mu.RLock()
	defer b.mu.RUnlock()
	for client := range b.rooms[eventID] {
		if client == exclude {
			continue
		}
		select {
		case client.Send <- data:
		default:
			// client buffer full, skip
		}
	}
}
