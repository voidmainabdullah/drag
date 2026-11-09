import { createFileRoute } from '@tanstack/react-router'
import { ModulePage } from '#/pages/ModulePage'

export const Route = createFileRoute('/m/$moduleId')({
  head: () => ({ meta: [{ title: 'Module · Xcrm' }] }),
  component: ModuleRoute,
})

function ModuleRoute() {
  const { moduleId } = Route.useParams()
  return <ModulePage moduleId={moduleId} />
}
