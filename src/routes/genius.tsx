import { createFileRoute } from '@tanstack/react-router'
import { GeniusPage } from '#/pages/GeniusPage'

export const Route = createFileRoute('/genius')({
  head: () => ({ meta: [{ title: 'Genius AI · Xcrm' }] }),
  component: GeniusPage,
})
