/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { getSession } from '~/lib/session'
import { signOut } from '~/lib/auth-client'
import appCss from '~/styles.css?url'

export const Route = createRootRoute({
  beforeLoad: async () => ({ session: await getSession() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Livestream' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { session } = Route.useRouteContext()
  const router = useRouter()
  return (
    <RootDocument>
      <header>
        <Link to="/"><strong>Livestream</strong></Link>
        <span className="spacer" />
        {session ? (
          <>
            <span className="muted">{session.user.name}</span>
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
          <Link to="/login">Sign in</Link>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </RootDocument>
  )
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
