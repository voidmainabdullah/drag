import { createFileRoute } from '@tanstack/react-router'
import { PublicFormPage } from '#/pages/PublicFormPage'

export const Route = createFileRoute('/f/$formId')({
  head: () => ({ meta: [{ title: 'Form · Xcrm' }] }),
  component: PublicRoute,
})

function PublicRoute() {
  const { formId } = Route.useParams()
  return <PublicFormPage formId={formId} />
}
