import type { ID, Workspace } from '#/types'
import { createWorkspace } from './workspaceService'

/** Where newly created modules (or an installed template) should live. */
export type DestinationMode = 'current' | 'new' | 'hidden'

export interface Destination {
  mode: DestinationMode
  /** only used when mode === 'new' */
  workspaceName: string
}

export const DESTINATION_OPTIONS: { id: DestinationMode; label: string; hint: string; icon: string }[] = [
  { id: 'current', label: 'Add to current workspace', hint: 'Shows up in this workspace’s sidebar next to your other modules.', icon: 'Briefcase' },
  { id: 'new', label: 'Create in a new empty workspace', hint: 'A completely blank workspace — no default modules or sidebar items. Its data is fully isolated from your other workspaces.', icon: 'Folder' },
  { id: 'hidden', label: 'Don’t show in sidebar', hint: 'Created in this workspace but kept out of the sidebar. Find it under All Modules and add it later.', icon: 'EyeOff' },
]

export const isDestinationValid = (d: Destination) => d.mode !== 'new' || d.workspaceName.trim().length > 0

export interface ResolvedDestination {
  workspaceId: ID
  showInNav: boolean
  createdWorkspace?: Workspace
}

/** Creates the blank workspace when needed (switching to it) and says where to put the modules. */
export function resolveDestination(d: Destination, currentWorkspaceId: ID): ResolvedDestination {
  if (d.mode === 'new') {
    const ws = createWorkspace({ name: d.workspaceName.trim() || 'New workspace', empty: true })
    return { workspaceId: ws.id, showInNav: true, createdWorkspace: ws }
  }
  return { workspaceId: currentWorkspaceId, showInNav: d.mode !== 'hidden' }
}

export function destinationMessage(d: Destination, resolved: ResolvedDestination): string {
  if (resolved.createdWorkspace) return `Created in the new workspace “${resolved.createdWorkspace.name}” — you’re there now.`
  if (d.mode === 'hidden') return 'Not shown in the sidebar. Open it from All Modules.'
  return 'Added to the current workspace.'
}
