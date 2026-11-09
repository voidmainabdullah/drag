import { createFileRoute } from '@tanstack/react-router'
import { ImportExportPage } from '#/pages/ImportExportPage'

export const Route = createFileRoute('/import-export')({
  head: () => ({ meta: [{ title: 'Import / Export · Xcrm' }] }),
  component: ImportExportPage,
})
