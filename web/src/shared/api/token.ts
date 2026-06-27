const TOKEN_PREFIX = 'availability_token_'
const EVENTS_KEY = 'availability_events'

export function getToken(eventId: string): string | null {
  return localStorage.getItem(TOKEN_PREFIX + eventId)
}

export function setToken(eventId: string, token: string): void {
  localStorage.setItem(TOKEN_PREFIX + eventId, token)
}

export function removeToken(eventId: string): void {
  localStorage.removeItem(TOKEN_PREFIX + eventId)
  removeKnownEvent(eventId)
}

type KnownEvent = {
  eventId: string
  title: string
  lastVisited: number
}

export function getKnownEvents(): KnownEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    if (!raw) return []
    const events: KnownEvent[] = JSON.parse(raw)
    return events
      .filter((e) => getToken(e.eventId) !== null)
      .sort((a, b) => b.lastVisited - a.lastVisited)
  } catch {
    return []
  }
}

export function trackEvent(eventId: string, title: string): void {
  const events = getKnownEvents()
  const existing = events.findIndex((e) => e.eventId === eventId)
  const entry: KnownEvent = { eventId, title, lastVisited: Date.now() }
  if (existing >= 0) {
    events[existing] = entry
  } else {
    events.push(entry)
  }
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
}

function removeKnownEvent(eventId: string): void {
  const events = getKnownEvents()
  const filtered = events.filter((e) => e.eventId !== eventId)
  localStorage.setItem(EVENTS_KEY, JSON.stringify(filtered))
}
