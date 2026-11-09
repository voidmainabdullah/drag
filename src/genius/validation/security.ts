import type { PermissionKey } from '#/types'
import type { AnyOp, Change } from '../compiler/apply'
import { workspaceTag } from '../compiler/ids'
import { isAiRole, type ConfigModel } from '../config/model'
import { CONFIG_PERMISSION, canGrant, canModule, can, type Actor, type ConfigKind } from '../permissions/policy'
import { PROTECTED_ROLE_IDS } from '../registry'
import { issue, type Issue } from './issues'

const s = 'security' as const

const UNSAFE: { re: RegExp; what: string }[] = [
  { re: /<\s*(script|iframe|object|embed|style|link|meta|svg)\b/i, what: 'HTML/script markup' },
  { re: /javascript\s*:|data\s*:\s*text\/html|vbscript\s*:/i, what: 'a script URL' },
  { re: /\bon[a-z]{3,}\s*=\s*["']/i, what: 'an inline event handler' },
  { re: /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?|messages?)/i, what: 'an instruction-override phrase' },
  { re: /\b(reveal|print|show|leak)\s+(the\s+|your\s+)?(system\s+prompt|api\s*key|secret|token)/i, what: 'a request to reveal secrets' },
  { re: /\bprocess\.env\b|\bgsk_[A-Za-z0-9]{16,}|\bsb_secret_[A-Za-z0-9_-]{10,}|\bsk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{24,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, what: 'something that looks like a secret or credential' },
  { re: /\b(drop\s+table|union\s+select|;\s*delete\s+from)\b/i, what: 'SQL' },
]

/** Collect string leaves, skipping the formula expression language (which has its own parser and sandbox). */
function strings(v: unknown, path: string, out: { path: string; value: string }[], skipKey?: (k: string) => boolean) {
  if (typeof v === 'string') out.push({ path, value: v })
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out, skipKey))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') out.push({ path: `${path}.${k}`, value: '__proto__' })
      if (skipKey?.(k)) continue
      strings(x, path ? `${path}.${k}` : k, out, skipKey)
    }
}

export interface SecurityInput {
  ops: AnyOp[]
  actor: Actor
  projectId?: string
  expectedProjectId: string
  workspaceId: string
  foreignIds?: Set<string>
  changes: Change[]
  next?: ConfigModel
  prev: ConfigModel
}

/** Checks that need only the request (run even when compilation failed). */
export function requestSecurity(i: SecurityInput): Issue[] {
  const out: Issue[] = []
  if (i.projectId !== undefined && i.projectId !== i.expectedProjectId)
    out.push(issue(s, 'SEC_PROJECT_MISMATCH', 'meta.projectId', 'The blueprint belongs to a different project/workspace', 'Use the project id given in the context; never copy one from elsewhere.'))

  const leaves: { path: string; value: string }[] = []
  i.ops.forEach((op, n) => strings(op, `ops[${n}]`, leaves, (k) => k === 'expression'))
  const tag = workspaceTag(i.workspaceId)
  const seen = new Set<string>()
  for (const l of leaves) {
    if (l.value === '__proto__') out.push(issue(s, 'SEC_UNSAFE_CONTENT', l.path, 'Reserved key name', 'Remove it.'))
    for (const u of UNSAFE) if (u.re.test(l.value) && !seen.has(l.path)) {
      seen.add(l.path)
      out.push(issue(s, 'SEC_UNSAFE_CONTENT', l.path, `Text contains ${u.what}; configuration text must be plain labels and descriptions`, 'Replace it with plain text.'))
    }
    // ids that carry another workspace's tag, or ids known to belong to another tenant
    const m = /^(mod|form|view|wf|dash)_([0-9a-f]{6})_/.exec(l.value)
    if (m && m[2] !== tag) out.push(issue(s, 'SEC_CROSS_TENANT', l.path, `"${l.value}" belongs to a different workspace`, 'Reference only components from the current workspace.'))
    else if (i.foreignIds?.has(l.value)) out.push(issue(s, 'SEC_CROSS_TENANT', l.path, `"${l.value}" is not part of this workspace`, 'Reference only components from the current workspace.'))
  }

  // roles and permission rules: AI configuration can never escalate
  const actorRole = i.actor.role
  for (const [n, op] of i.ops.entries()) {
    const p = `ops[${n}]`
    if (op.op === 'add_role') {
      for (const g of op.role.grants) {
        if (!canGrant(i.actor, g as PermissionKey)) out.push(issue(s, 'SEC_ESCALATION', `${p}.role.grants`, g === 'accessSettings' ? 'AI configuration can never grant access to settings' : `You do not hold "${g}" yourself, so a role you ask for cannot receive it`, 'Remove the grant.'))
      }
    }
    if (op.op === 'update_permissions') {
      const r = op.rule
      const protectedRole = PROTECTED_ROLE_IDS.has(r.roleId)
      const reduces = (r.access && (!r.access.view || !r.access.create || !r.access.edit || !r.access.delete)) || (r.recordScope && r.recordScope !== 'all') || r.fieldAccess?.some((f) => f.access !== 'edit')
      if (protectedRole && reduces) out.push(issue(s, 'SEC_PROTECTED_ROLE', p, `The built-in ${r.roleId === 'role_owner' ? 'Owner' : 'Admin'} role cannot be restricted: it would lock people out`, 'Apply restrictions to another role.'))
      const mod = i.next?.modules.find((m) => m.id === r.moduleId) ?? i.prev.modules.find((m) => m.id.endsWith(`_${r.moduleId}`) || m.id === r.moduleId)
      const roleKnown = (i.next ?? i.prev).roles.find((x) => x.id === r.roleId)
      // granting is limited to what the requesting user holds, on modules they can access themselves
      if (r.access) {
        for (const k of ['view', 'create', 'edit', 'delete'] as const) {
          if (r.access[k] && !(mod ? canModule(actorRole, mod, k) : can(actorRole, 'viewModules'))) out.push(issue(s, 'SEC_ESCALATION', `${p}.access.${k}`, `You cannot ${k} this module yourself, so you cannot grant "${k}" to ${roleKnown?.name ?? r.roleId}`, 'Remove the grant.'))
        }
      }
      if (r.recordScope === 'all' && roleKnown && !isAiRole(roleKnown) && !can(actorRole, 'accessSettings'))
        out.push(issue(s, 'SEC_ESCALATION', `${p}.recordScope`, `Widening what ${roleKnown.name} can see on existing roles needs the access-settings permission`, 'Remove the rule.'))
    }
  }
  return out
}

/** Checks on the compiled result and the actor's authority for each kind of change. */
export function resultSecurity(i: SecurityInput): Issue[] {
  const out: Issue[] = []
  const kinds = new Map<ConfigKind, number>()
  for (const c of i.changes) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
  for (const [k, n] of kinds) {
    const need = CONFIG_PERMISSION[k]
    if (!can(i.actor.role, need)) out.push(issue(s, 'SEC_PERMISSION_DENIED', `changes.${k}`, `Your role cannot change ${k}s (${n} change${n === 1 ? '' : 's'} requested): it needs "${need}"`, 'Remove those changes or ask someone with that permission.'))
  }
  const next = i.next
  if (next) {
    for (const r of next.roles) if (isAiRole(r) && r.permissions.accessSettings) out.push(issue(s, 'SEC_ESCALATION', `roles.${r.id}`, `AI role "${r.name}" would hold access to settings`, 'Remove accessSettings from the role.'))
    const prevForms = new Map(i.prev.forms.map((f) => [f.id, f]))
    for (const f of next.forms) if (f.public?.enabled && !prevForms.get(f.id)?.public?.enabled) out.push(issue(s, 'SEC_PUBLIC_FORM', `forms.${f.id}`, `Form "${f.name}" would be publicly reachable`, 'AI configuration never publishes forms; a person turns that on.'))
  }
  return out
}
