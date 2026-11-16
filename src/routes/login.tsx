import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { signIn, signUp } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: '/' })
  },
  component: Login,
})

function Login() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setPending(true)
    setError(null)
    const res =
      mode === 'signup'
        ? await signUp.email({ email, password, name: String(form.get('name')) })
        : await signIn.email({ email, password })
    setPending(false)
    if (res.error) return setError(res.error.message ?? 'Something went wrong')
    await router.invalidate()
    await router.navigate({ to: '/' })
  }

  return (
    <div className="card">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <form onSubmit={onSubmit}>
        {mode === 'signup' && <input name="name" placeholder="Display name" required />}
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" minLength={8} required />
        {error && <p className="error">{error}</p>}
        <button disabled={pending}>{mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
        <button
          type="button"
          className="secondary"
          onClick={() => signIn.social({ provider: 'github', callbackURL: '/' })}
        >
          Continue with GitHub
        </button>
        <button type="button" className="secondary" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
