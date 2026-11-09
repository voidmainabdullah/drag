import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '#/pages/AnalyticsPage'

export const Route = createFileRoute('/analytics')({
  head: () => ({ meta: [{ title: 'Data Analytics · Xcrm' }] }),
  component: AnalyticsPage,
})
