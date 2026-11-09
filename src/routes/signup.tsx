import { createFileRoute } from '@tanstack/react-router'
import { AuthPage } from '#/pages/AuthPage'

export const Route = createFileRoute('/signup')({
  head: () => ({ meta: [{ title: 'Create account · Xcrm' }] }),
  component: () => <AuthPage mode="signup" />,
})
