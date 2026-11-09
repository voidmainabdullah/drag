import { createFileRoute } from '@tanstack/react-router'
import { AuthPage } from '#/pages/AuthPage'

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Sign in · Xcrm' }] }),
  component: () => <AuthPage mode="login" />,
})
