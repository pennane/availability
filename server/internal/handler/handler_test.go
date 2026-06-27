package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/pennane/availability/server/internal/db"
	"github.com/pennane/availability/server/internal/handler"
	"github.com/pennane/availability/server/internal/repository"
	"github.com/pennane/availability/server/internal/ws"
)

func setupServer(t *testing.T) (*chi.Mux, func()) {
	t.Helper()
	database, _ := db.New(":memory:")
	db.Migrate(database)

	h := handler.New(
		repository.NewSQLiteEventRepo(database),
		repository.NewSQLiteParticipantRepo(database),
		repository.NewSQLiteEventDateRepo(database),
		repository.NewSQLiteAvailabilityRepo(database),
		ws.NewBroadcast(),
	)

	r := chi.NewRouter()
	r.Post("/events", h.CreateEvent)
	r.Get("/events/{eventId}", func(w http.ResponseWriter, req *http.Request) {
		h.GetEvent(w, req, chi.URLParam(req, "eventId"))
	})
	r.Post("/events/{eventId}/me", func(w http.ResponseWriter, req *http.Request) {
		h.JoinEvent(w, req, chi.URLParam(req, "eventId"))
	})
	r.Get("/events/{eventId}/me", func(w http.ResponseWriter, req *http.Request) {
		h.GetMyParticipation(w, req, chi.URLParam(req, "eventId"))
	})
	r.Patch("/events/{eventId}/me", func(w http.ResponseWriter, req *http.Request) {
		h.UpdateMyParticipation(w, req, chi.URLParam(req, "eventId"))
	})
	r.Put("/events/{eventId}/me/availability", func(w http.ResponseWriter, req *http.Request) {
		h.ReplaceAvailability(w, req, chi.URLParam(req, "eventId"))
	})
	r.Patch("/events/{eventId}", func(w http.ResponseWriter, req *http.Request) {
		h.UpdateEvent(w, req, chi.URLParam(req, "eventId"))
	})
	r.Post("/events/{eventId}/dates", func(w http.ResponseWriter, req *http.Request) {
		h.SuggestDate(w, req, chi.URLParam(req, "eventId"))
	})

	return r, func() { database.Close() }
}

func TestCreateAndGetEvent(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	body := `{
		"title": "Team Standup",
		"timezone": "Europe/Helsinki",
		"timeSlotConfig": {"durationMinutes": 30, "rangeStart": "09:00", "rangeEnd": "17:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": ["2026-07-15", "2026-07-16"]
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201. body: %s", w.Code, w.Body.String())
	}

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]
	hostToken := createResp["hostToken"]

	if eventID == "" || hostToken == "" {
		t.Fatal("missing eventId or hostToken in response")
	}

	// Get as anonymous
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", w.Code)
	}

	var eventResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &eventResp)
	if eventResp["role"] != "public" {
		t.Errorf("role = %v, want public", eventResp["role"])
	}

	// Get as host
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	json.Unmarshal(w.Body.Bytes(), &eventResp)
	if eventResp["role"] != "host" {
		t.Errorf("role = %v, want host", eventResp["role"])
	}
}

func TestJoinEvent(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	// Create event first
	body := `{
		"title": "Test Event",
		"timezone": "UTC",
		"timeSlotConfig": {"durationMinutes": 60, "rangeStart": "10:00", "rangeEnd": "18:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": ["2026-08-01"]
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]

	// Join event
	joinBody := `{"name": "Alice"}`
	req = httptest.NewRequest("POST", "/events/"+eventID+"/me", bytes.NewBufferString(joinBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("join status = %d, want 201. body: %s", w.Code, w.Body.String())
	}

	var joinResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &joinResp)
	participantID := joinResp["participantId"]
	participantToken := joinResp["token"]

	if participantID == "" || participantToken == "" {
		t.Fatal("missing participantId or token in join response")
	}

	// Get event as participant — should see participant role
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	req.Header.Set("Authorization", "Bearer "+participantToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var eventResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &eventResp)
	if eventResp["role"] != "participant" {
		t.Errorf("role = %v, want participant", eventResp["role"])
	}
}

func TestReplaceAvailability(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	// Create event
	body := `{
		"title": "Avail Test",
		"timezone": "UTC",
		"timeSlotConfig": {"durationMinutes": 60, "rangeStart": "10:00", "rangeEnd": "12:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": ["2026-09-01"]
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]

	// Get dates to find eventDateId
	req = httptest.NewRequest("GET", "/events/"+eventID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var eventResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &eventResp)
	dates := eventResp["dates"].([]any)
	eventDateID := dates[0].(map[string]any)["id"].(string)

	// Join event
	req = httptest.NewRequest("POST", "/events/"+eventID+"/me", bytes.NewBufferString(`{"name":"Bob"}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var joinResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &joinResp)
	token := joinResp["token"]

	// Replace availability
	availBody, _ := json.Marshal(map[string]any{
		"entries": []map[string]any{
			{"eventDateId": eventDateID, "slot": "2026-09-01T10:00", "kind": "available"},
		},
	})
	req = httptest.NewRequest("PUT", "/events/"+eventID+"/me/availability", bytes.NewBuffer(availBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("availability status = %d, want 200. body: %s", w.Code, w.Body.String())
	}

	var availResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &availResp)
	avail := availResp["availability"].([]any)
	if len(avail) != 1 {
		t.Errorf("availability len = %d, want 1", len(avail))
	}
}

func TestGetMyParticipation(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	// Create event and join
	createBody := `{
		"title": "Me Test",
		"timezone": "UTC",
		"timeSlotConfig": {"durationMinutes": 30, "rangeStart": "08:00", "rangeEnd": "10:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "closed"},
		"dates": []
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(createBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]

	req = httptest.NewRequest("POST", "/events/"+eventID+"/me", bytes.NewBufferString(`{"name":"Carol"}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var joinResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &joinResp)
	token := joinResp["token"]

	// Get my participation
	req = httptest.NewRequest("GET", "/events/"+eventID+"/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /me status = %d, want 200. body: %s", w.Code, w.Body.String())
	}

	var meResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &meResp)
	if meResp["name"] != "Carol" {
		t.Errorf("name = %v, want Carol", meResp["name"])
	}
}

func TestUpdateEvent_ImmutableFieldsRejected(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	// Create event
	body := `{
		"title": "Immutable Test",
		"timezone": "Europe/Helsinki",
		"timeSlotConfig": {"durationMinutes": 30, "rangeStart": "09:00", "rangeEnd": "17:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": []
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]
	hostToken := createResp["hostToken"]

	// Try to patch timezone — must be rejected
	patchBody := `{"timezone": "America/New_York"}`
	req = httptest.NewRequest("PATCH", "/events/"+eventID, bytes.NewBufferString(patchBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("patch timezone status = %d, want 400", w.Code)
	}
}

func TestSuggestDate(t *testing.T) {
	r, cleanup := setupServer(t)
	defer cleanup()

	// Create event with open suggestions
	body := `{
		"title": "Suggest Test",
		"timezone": "UTC",
		"timeSlotConfig": {"durationMinutes": 60, "rangeStart": "10:00", "rangeEnd": "18:00"},
		"visibility": {"kind": "names-visible"},
		"suggestions": {"kind": "open"},
		"dates": []
	}`
	req := httptest.NewRequest("POST", "/events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &createResp)
	eventID := createResp["eventId"]

	// Join event
	req = httptest.NewRequest("POST", "/events/"+eventID+"/me", bytes.NewBufferString(`{"name":"Dave"}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var joinResp map[string]string
	json.Unmarshal(w.Body.Bytes(), &joinResp)
	token := joinResp["token"]

	// Suggest a date
	req = httptest.NewRequest("POST", "/events/"+eventID+"/dates", bytes.NewBufferString(`{"date":"2026-10-01"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("suggest date status = %d, want 201. body: %s", w.Code, w.Body.String())
	}

	// Suggest same date again — should be 409
	req = httptest.NewRequest("POST", "/events/"+eventID+"/dates", bytes.NewBufferString(`{"date":"2026-10-01"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("duplicate date status = %d, want 409", w.Code)
	}
}
