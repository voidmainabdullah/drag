import { createFileRoute } from '@tanstack/react-router'
import { ReportsPage } from '#/pages/ReportsPage'

export const Route = createFileRoute('/reports')({
  head: () => ({ meta: [{ title: 'Reports · Xcrm' }] }),
  component: ReportsPage,
})
