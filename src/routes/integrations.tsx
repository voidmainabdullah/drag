import { createFileRoute } from '@tanstack/react-router'
import { IntegrationsPage } from '#/pages/IntegrationsPage'

export const Route = createFileRoute('/integrations')({
  head: () => ({ meta: [{ title: 'Integrations · Xcrm' }] }),
  component: IntegrationsPage,
})
