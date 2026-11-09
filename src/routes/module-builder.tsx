import { createFileRoute } from '@tanstack/react-router'
import { ModuleBuilderPage } from '#/pages/ModuleBuilderPage'

export const Route = createFileRoute('/module-builder')({
  head: () => ({ meta: [{ title: 'Module Builder · Xcrm' }] }),
  component: ModuleBuilderPage,
})
