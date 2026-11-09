import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/Button'
import { Field, Input } from '#/components/ui/controls'
import { Notice } from '#/components/ui/misc'
import { signInWithPassword, signUpWithPassword } from '#/genius/auth/authStore'

/** Sign in / sign up. Shares the app's design language (gradient brand mark, surface cards, Notice). */
export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setInfo(undefined)
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.')
    if (signup && password.length < 8) return setError('Choose a password with at least 8 characters.')
    if (!password) return setError('Enter your password.')
    setBusy(true)
    const res = signup ? await signUpWithPassword(email, password) : await signInWithPassword(email, password)
    setBusy(false)
    if (!res.ok) return setError(res.message)
    if (res.needsConfirmation) return setInfo('Account created. Check your inbox and confirm your email, then sign in.')
    // a full reload starts the app cleanly inside this account's own storage namespace
    window.location.assign('/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="gradient-brand flex size-9 items-center justify-center rounded-lg text-base font-bold text-white shadow-sm" aria-hidden>X</span>
          <span className="text-xl font-bold tracking-tight">Xcrm</span>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm" aria-labelledby="auth-title" noValidate>
          <div>
            <h1 id="auth-title" className="text-lg font-semibold">{signup ? 'Create your account' : 'Welcome back'}</h1>
            <p className="mt-1 text-[13px] text-muted">{signup ? 'Your CRM is stored privately under your account.' : 'Sign in to open your CRM.'}</p>
          </div>
          {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
          {info && <div role="status"><Notice tone="success">{info}</Notice></div>}
          <Field label="Email" required>
            <Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" placeholder="you@company.com" />
          </Field>
          <Field label="Password" required hint={signup ? 'At least 8 characters.' : undefined}>
            <Input type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          </Field>
          <Button type="submit" variant="gradient" size="md" className="w-full" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</Button>
          <p className="text-center text-[13px] text-muted">
            {signup ? 'Already have an account? ' : 'New here? '}
            <Link to={signup ? '/login' : '/signup'} className="font-medium text-primary hover:underline">{signup ? 'Sign in' : 'Create an account'}</Link>
          </p>
        </form>
        <p className="mt-4 text-center text-xs text-muted">Your CRM data stays in this browser, under your account. Only AI requests are sent to our server.</p>
      </div>
    </main>
  )
}
