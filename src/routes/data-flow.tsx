import { createFileRoute } from '@tanstack/react-router'
import { DataFlowPage } from '#/pages/DataFlowPage'

export const Route = createFileRoute('/data-flow')({
  head: () => ({ meta: [{ title: 'Data Flow · Xcrm' }] }),
  component: DataFlowPage,
})
