import { createFileRoute } from '@tanstack/react-router'
import { TeamPage } from '#/pages/TeamPage'

export const Route = createFileRoute('/team')({
  head: () => ({ meta: [{ title: 'Team · Xcrm' }] }),
  component: TeamPage,
})
