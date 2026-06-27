package domain

import (
	"crypto/rand"
	"encoding/base64"

	"github.com/google/uuid"
)

func NewID() string {
	return uuid.Must(uuid.NewV7()).String()
}

func NewToken() string {
	b := make([]byte, 16) // 128 bits
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
