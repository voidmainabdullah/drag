import type { DataFlowLink, Dashboard, Form, Module, View, Workflow, WorkflowRun } from '#/types'
import { KEYS, readJson, writeJson } from './storageService'

const arr = <T>(key: string): T[] => {
  const v = readJson<unknown>(key, [])
  return Array.isArray(v) ? (v as T[]) : []
}

export const moduleStorage = {
  loadModules: () => arr<Module>(KEYS.modules),
  saveModules: (v: Module[]) => writeJson(KEYS.modules, v),
  loadForms: () => arr<Form>(KEYS.forms),
  saveForms: (v: Form[]) => writeJson(KEYS.forms, v),
  loadViews: () => arr<View>(KEYS.views),
  saveViews: (v: View[]) => writeJson(KEYS.views, v),
  loadDashboards: () => arr<Dashboard>(KEYS.dashboards),
  saveDashboards: (v: Dashboard[]) => writeJson(KEYS.dashboards, v),
  loadWorkflows: () => arr<Workflow>(KEYS.workflows),
  saveWorkflows: (v: Workflow[]) => writeJson(KEYS.workflows, v),
  loadDataFlows: () => arr<DataFlowLink>(KEYS.dataflows),
  saveDataFlows: (v: DataFlowLink[]) => writeJson(KEYS.dataflows, v),
  loadRuns: () => arr<WorkflowRun>(KEYS.workflowRuns),
  saveRuns: (v: WorkflowRun[]) => writeJson(KEYS.workflowRuns, v),
}
