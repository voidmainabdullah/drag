import { Page } from '#/components/layout/Page'
import { PageHeader } from '#/components/ui/misc'
import { DataFlowWorkspace } from '#/builders/DataFlow/DataFlowWorkspace'

export function DataFlowPage() {
  return (
    <Page title="Data Flow" wide skeleton="cards">
      <PageHeader title="Data Flow" icon="Network" description="Connect modules: when a record is created, updated or deleted, create, update or link records in another module." />
      <DataFlowWorkspace />
    </Page>
  )
}
