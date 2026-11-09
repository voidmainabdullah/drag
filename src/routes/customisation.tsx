import { createFileRoute } from '@tanstack/react-router'
import { CustomisationPage } from '#/pages/CustomisationPage'

export const Route = createFileRoute('/customisation')({
  head: () => ({ meta: [{ title: 'Customisation · Xcrm' }] }),
  component: CustomisationPage,
})
