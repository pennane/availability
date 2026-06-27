import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router'

const rootRoute = createRootRoute()

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <div>Home — Create an event</div>,
})

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: () => <div>Event view</div>,
})

const eventWithTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/$token',
  component: () => <div>Token extraction</div>,
})

const routeTree = rootRoute.addChildren([indexRoute, eventRoute, eventWithTokenRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
