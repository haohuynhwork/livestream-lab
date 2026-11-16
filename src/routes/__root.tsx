/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { getSession } from '~/lib/session'
import { signOut } from '~/lib/auth-client'
import { RealtimeProvider, useRealtimeEvent } from '~/lib/realtime-client'
import { IncomingCall } from '~/components/IncomingCall'
import { NotificationsButton } from '~/components/NotificationsButton'
import livekitCss from '@livekit/components-styles?url'
import appCss from '~/styles.css?url'

export const Route = createRootRoute({
  beforeLoad: async () => ({ session: await getSession() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Livestream' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'stylesheet', href: livekitCss },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { session } = Route.useRouteContext()
  const router = useRouter()
  return (
    <RootDocument>
      <RealtimeProvider enabled={!!session}>
        <header>
          <Link to="/" className="brand">
            <strong>● Livestream</strong>
          </Link>
          <nav>
            <Link to="/" activeOptions={{ exact: true }}>
              Live
            </Link>
            {session && (
              <>
                <Link to="/messages">Messages</Link>
                <Link to="/recordings">Recordings</Link>
              </>
            )}
          </nav>
          <span className="spacer" />
          {session ? (
            <>
              <NotificationsButton />
              <Link to="/go-live" className="button">
                Go live
              </Link>
              <span className="muted hide-sm">{session.user.name}</span>
              <button
                className="secondary"
                onClick={async () => {
                  await signOut()
                  await router.invalidate()
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" className="button">
              Sign in
            </Link>
          )}
        </header>
        {session && (
          <>
            <IncomingCall />
            <LiveNotifier />
          </>
        )}
        <Outlet />
      </RealtimeProvider>
    </RootDocument>
  )
}

/** Refresh the live list when someone you follow goes live. */
function LiveNotifier() {
  const router = useRouter()
  useRealtimeEvent((e) => {
    if (e.t === 'stream.live') void router.invalidate({ filter: (m) => m.routeId === '/' })
  })
  return null
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
