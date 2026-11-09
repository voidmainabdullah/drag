import { createFileRoute } from '@tanstack/react-router'
import { FormsPage } from '#/pages/FormsPage'

export const Route = createFileRoute('/forms')({
  head: () => ({ meta: [{ title: 'Form Builder · Xcrm' }] }),
  component: FormsPage,
})
