import { createFileRoute } from '@tanstack/react-router'
import { MyWorkspacePage } from '#/pages/MyWorkspacePage'

export const Route = createFileRoute('/my-workspace')({
  head: () => ({ meta: [{ title: 'My Workspace · Xcrm' }] }),
  component: MyWorkspacePage,
})
