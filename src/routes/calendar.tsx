import { createFileRoute } from '@tanstack/react-router'
import { CalendarPage } from '#/pages/CalendarPage'

export const Route = createFileRoute('/calendar')({
  head: () => ({ meta: [{ title: 'Calendar · Xcrm' }] }),
  component: CalendarPage,
})
