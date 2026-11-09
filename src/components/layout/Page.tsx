import type { ReactNode } from 'react'
import { useBriefLoading, usePageTitle } from '#/hooks/useData'
import { PageSkeleton } from '#/components/ui/misc'
import { cn } from '#/utils/id'

/** Page wrapper: sets the document title and shows a brief shimmer skeleton while data "loads". */
export function Page({ title, skeleton = 'cards', children, wide = false, loadKey }: { title: string; skeleton?: 'cards' | 'table' | 'form'; children: ReactNode; wide?: boolean; loadKey?: string }) {
  usePageTitle(`${title} · Xcrm`)
  const loading = useBriefLoading(`${title}:${loadKey ?? ''}`)
  return <div className={cn('mx-auto w-full', wide ? 'max-w-none' : 'max-w-7xl')}>{loading ? <PageSkeleton variant={skeleton} /> : children}</div>
}
