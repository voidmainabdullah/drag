import { createFileRoute } from '@tanstack/react-router'
import { DashboardsPage } from '#/pages/DashboardsPage'

export const Route = createFileRoute('/dashboards')({
  head: () => ({ meta: [{ title: 'Dashboards · Xcrm' }] }),
  component: DashboardsPage,
})
