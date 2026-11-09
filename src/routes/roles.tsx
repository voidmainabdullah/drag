import { createFileRoute } from '@tanstack/react-router'
import { RolesPage } from '#/pages/RolesPage'

export const Route = createFileRoute('/roles')({
  head: () => ({ meta: [{ title: 'Roles & Permissions · Xcrm' }] }),
  component: RolesPage,
})
