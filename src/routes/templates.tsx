import { createFileRoute } from '@tanstack/react-router'
import { TemplatesPage } from '#/pages/TemplatesPage'

export const Route = createFileRoute('/templates')({
  head: () => ({ meta: [{ title: 'Templates · Xcrm' }] }),
  component: TemplatesPage,
})
