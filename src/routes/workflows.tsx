import { createFileRoute } from '@tanstack/react-router'
import { WorkflowsPage } from '#/pages/WorkflowsPage'

export const Route = createFileRoute('/workflows')({
  head: () => ({ meta: [{ title: 'Workflows · Xcrm' }] }),
  component: WorkflowsPage,
})
