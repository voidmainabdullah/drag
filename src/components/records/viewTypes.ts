import type { CrmRecord, Field, Module, ViewConfig } from '#/types'
import type { Ctx } from '#/utils/records'

export interface ViewProps {
  module: Module
  records: CrmRecord[]
  config: ViewConfig
  ctx: Ctx
  /** visible, ordered fields */
  fields: Field[]
  selected: Set<string>
  onSelect: (ids: Set<string>) => void
  onOpen: (id: string) => void
  onConfig: (patch: Partial<ViewConfig>) => void
  canEdit: boolean
  canCreate: boolean
  onUpdateRecord: (id: string, patch: Record<string, unknown>) => void
  onAdd: (initial?: Record<string, unknown>) => void
}
