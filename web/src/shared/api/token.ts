const TOKEN_PREFIX = 'availability_token_'

export function getToken(eventId: string): string | null {
  return localStorage.getItem(TOKEN_PREFIX + eventId)
}

export function setToken(eventId: string, token: string): void {
  localStorage.setItem(TOKEN_PREFIX + eventId, token)
}

export function removeToken(eventId: string): void {
  localStorage.removeItem(TOKEN_PREFIX + eventId)
}
