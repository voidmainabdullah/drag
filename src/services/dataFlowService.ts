import type { DataFlowLink, ID } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { useDataFlowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { logActivity } from '#/stores/activityStore'

/** Adds a new flow or replaces an existing one. */
export function saveFlow(link: DataFlowLink): DataFlowLink {
  const st = useDataFlowStore.getState()
  const exists = st.items.some((x) => x.id === link.id)
  const next: DataFlowLink = { ...link, name: link.name.trim(), updatedAt: nowIso() }
  if (exists) st.update(link.id, next)
  else st.add(next)
  logActivity({ workspaceId: link.workspaceId, action: exists ? 'dataflow_updated' : 'dataflow_created', entity: 'workflow', moduleId: link.sourceModuleId, description: `${exists ? 'Updated' : 'Created'} data flow "${next.name}"` })
  return next
}

export function deleteFlow(id: ID) {
  const st = useDataFlowStore.getState()
  const f = st.items.find((x) => x.id === id)
  if (!f) return
  st.remove(id)
  logActivity({ workspaceId: f.workspaceId, action: 'dataflow_deleted', entity: 'workflow', moduleId: f.sourceModuleId, description: `Deleted data flow "${f.name}"` })
}

export function setFlowEnabled(id: ID, enabled: boolean) {
  useDataFlowStore.getState().update(id, { enabled })
}

export function duplicateFlow(id: ID): DataFlowLink | null {
  const st = useDataFlowStore.getState()
  const f = st.items.find((x) => x.id === id)
  if (!f) return null
  const t = nowIso()
  const copy: DataFlowLink = {
    ...structuredClone(f),
    id: uid('flow'),
    name: `${f.name} (copy)`,
    enabled: false,
    conditions: f.conditions.map((c) => ({ ...c, id: uid('cnd') })),
    action: { ...structuredClone(f.action), mappings: f.action.mappings.map((m) => ({ ...m, id: uid('map') })), sets: f.action.sets.map((s) => ({ ...s, id: uid('set') })) },
    createdAt: t,
    updatedAt: t,
  }
  st.add(copy)
  return copy
}

/** A module was deleted: flows that start or end there make no sense any more. */
export function removeFlowsForModule(moduleId: ID) {
  useDataFlowStore.getState().removeWhere((f) => f.sourceModuleId === moduleId || f.targetModuleId === moduleId)
}

/**
 * A field was deleted: drop every reference to it from the flows that use it.
 * Flows whose trigger or relationship field vanished are switched off instead of silently misbehaving.
 */
export function cleanFlowsForField(moduleId: ID, fieldId: string) {
  const st = useDataFlowStore.getState()
  for (const f of st.items) {
    const srcHit = f.sourceModuleId === moduleId
    const tgtHit = f.targetModuleId === moduleId
    if (!srcHit && !tgtHit) continue
    const a = f.action
    const next: DataFlowLink = {
      ...f,
      conditions: srcHit ? f.conditions.filter((c) => c.fieldId !== fieldId) : f.conditions,
      action: {
        ...a,
        mappings: a.mappings.filter((m) => !(srcHit && m.sourceFieldId === fieldId) && !(tgtHit && m.targetFieldId === fieldId)),
        sets: a.sets.filter((s) => !(tgtHit && s.targetFieldId === fieldId) && !(srcHit && s.mode === 'copy' && s.sourceFieldId === fieldId)),
        defaults: tgtHit ? Object.fromEntries(Object.entries(a.defaults).filter(([k]) => k !== fieldId)) : a.defaults,
        linkField: a.linkField && ((a.linkField.side === 'source' && srcHit) || (a.linkField.side === 'target' && tgtHit)) && a.linkField.fieldId === fieldId ? undefined : a.linkField,
        matchSourceFieldId: srcHit && a.matchSourceFieldId === fieldId ? undefined : a.matchSourceFieldId,
        matchTargetFieldId: tgtHit && a.matchTargetFieldId === fieldId ? undefined : a.matchTargetFieldId,
      },
    }
    let enabled = next.enabled
    if (srcHit && f.trigger.fieldId === fieldId) {
      next.trigger = { type: 'record_updated' }
      enabled = false
    }
    const needsLink = a.type !== 'create_linked'
    if (needsLink && !next.action.linkField) enabled = false
    if (a.type === 'link_records' && (!next.action.matchSourceFieldId || !next.action.matchTargetFieldId)) enabled = false
    if (a.type === 'update_linked' && !next.action.sets.length) enabled = false
    if (JSON.stringify(next) !== JSON.stringify(f)) st.update(f.id, { ...next, enabled })
  }
}

/** Remembers where a module's node sits on the canvas. */
export function setNodePositions(pos: Record<ID, { x: number; y: number }>) {
  const ms = useModuleStore.getState()
  const mods = ms.modules.filter((m) => pos[m.id])
  if (!mods.length) return
  useModuleStore.setState({
    modules: ms.modules.map((m) => (pos[m.id] ? { ...m, flowPos: { x: Math.round(pos[m.id].x), y: Math.round(pos[m.id].y) } } : m)),
  })
}
