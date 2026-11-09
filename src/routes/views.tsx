import { createFileRoute } from '@tanstack/react-router'
import { ViewsPage } from '#/pages/ViewsPage'

export const Route = createFileRoute('/views')({
  head: () => ({ meta: [{ title: 'View Builder · Xcrm' }] }),
  component: ViewsPage,
})
