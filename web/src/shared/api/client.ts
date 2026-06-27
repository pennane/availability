import createClient from 'openapi-fetch'
import type { paths } from './generated/schema'
import { getToken } from './token'

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export const api = createClient<paths>({
  baseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.use({
  onRequest({ request }) {
    const url = new URL(request.url)
    const eventId = url.pathname.match(/\/events\/([^/]+)/)?.[1]
    if (eventId) {
      const token = getToken(eventId)
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }
    }
    return request
  },
})
