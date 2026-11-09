import { createFileRoute } from '@tanstack/react-router'
import { FieldsPage } from '#/pages/FieldsPage'

export const Route = createFileRoute('/fields')({
  head: () => ({ meta: [{ title: 'Field Manager · Xcrm' }] }),
  component: FieldsPage,
})
