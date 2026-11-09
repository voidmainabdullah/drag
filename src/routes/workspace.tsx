import { createFileRoute, redirect } from '@tanstack/react-router'

// Legacy path kept so saved sidebars that still point at /workspace keep working.
export const Route = createFileRoute('/workspace')({
  beforeLoad: () => {
    throw redirect({ to: '/my-workspace' })
  },
})
