package handler

import (
	"encoding/json"
	"fmt"

	"github.com/pennane/availability/server/internal/domain"
)

func parseVisibility(raw json.RawMessage) (domain.VisibilityPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "names-visible":
		return domain.NamesVisibleVisibility{}, nil
	case "anonymous":
		return domain.AnonymousVisibility{}, nil
	default:
		return nil, fmt.Errorf("unknown visibility kind: %s", v.Kind)
	}
}

func parseSuggestionPolicy(raw json.RawMessage) (domain.SuggestionPolicy, error) {
	var v struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch v.Kind {
	case "open":
		return domain.OpenSuggestionPolicy{}, nil
	case "closed":
		return domain.ClosedSuggestionPolicy{}, nil
	default:
		return nil, fmt.Errorf("unknown suggestion policy kind: %s", v.Kind)
	}
}
