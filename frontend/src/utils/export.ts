import { db } from './db'
import { buildAssemblyPlan, type AssemblyPlan, type PlanBlocker } from './assemblyPlan'

export interface MortiseExport {
  exportedAt: string
  joints: unknown[]
  members: unknown[]
  steps: unknown[]
  diagrams: unknown[]
  furniture: unknown[]
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, payload: unknown): void {
  downloadText(filename, JSON.stringify(payload, null, 2))
}

export async function exportAllData(): Promise<void> {
  const [joints, members, steps, diagrams, furniture] = await Promise.all([
    db.joints.toArray(),
    db.members.toArray(),
    db.steps.toArray(),
    db.diagrams.toArray(),
    db.furniture.toArray(),
  ])
  downloadJson(`榫卯图鉴-全部数据-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints,
    members,
    steps,
    diagrams,
    furniture,
  })
}

export async function exportJointData(jointTypeId: string, jointName: string): Promise<void> {
  const [joint, members, steps, diagrams, furniture] = await Promise.all([
    db.joints.get(jointTypeId),
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
    db.furniture.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  downloadJson(`榫卯图鉴-${jointName}-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints: joint ? [joint] : [],
    members,
    steps,
    diagrams,
    furniture,
  })
}

/** 导出阻挡原因，结构稳定，便于外部系统读取 */
export interface ExportedBlocker extends PlanBlocker {}

export interface AssemblyPlanExport {
  exportedAt: string
  joint: {
    id: string
    name: string
    family: string
    difficulty: string
  } | null
  summary: {
    totalSteps: number
    executableCount: number
    blockedCount: number
    pendingRelations: number
    hasCycle: boolean
  }
  plan: Array<{
    seq: number
    stepId: string
    action: string
    direction: string
    tool: string
    member: { id: string; name: string; part: string } | null
    prerequisites: Array<{ seq: number; stepId: string; action: string }>
    startStep: boolean
    status: '可执行' | '不可执行'
    exception: {
      active: boolean
      stale: boolean
      reason: string
      grantedAt: string
    } | null
    blockers: ExportedBlocker[]
    /** 人类可读的阻挡原因汇总，与页面文案一致 */
    blockReasons: string[]
    holdSec: number
    riskNote: string
  }>
  pendingRelations: Array<{
    seq: number
    stepId: string
    missing: Array<'前置' | '构件'>
    detail: string[]
  }>
}

export async function exportAssemblyPlan(jointTypeId: string, jointName: string): Promise<void> {
  const [joint, members, steps] = await Promise.all([
    db.joints.get(jointTypeId),
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).sortBy('seq'),
  ])

  const plan: AssemblyPlan = buildAssemblyPlan(steps, members)

  const payload: AssemblyPlanExport = {
    exportedAt: new Date().toISOString(),
    joint: joint
      ? { id: joint.id, name: joint.name, family: joint.family, difficulty: joint.difficulty }
      : null,
    summary: {
      totalSteps: plan.steps.length,
      executableCount: plan.executableCount,
      blockedCount: plan.blockedCount,
      pendingRelations: plan.pendingRelationSteps.length,
      hasCycle: plan.cycleStepIds.size > 0,
    },
    plan: plan.steps.map((item) => ({
      seq: item.step.seq,
      stepId: item.step.id,
      action: item.step.action,
      direction: item.step.direction,
      tool: item.step.tool,
      member: item.member
        ? { id: item.member.id, name: item.member.name, part: item.member.part }
        : null,
      prerequisites: item.prereqs.map((prereq) => ({
        seq: prereq.seq,
        stepId: prereq.id,
        action: prereq.action,
      })),
      startStep: Boolean(item.step.isStart),
      status: item.executable ? '可执行' as const : '不可执行' as const,
      exception: item.step.exception
        ? {
          active: item.exceptionActive,
          stale: item.exceptionStale,
          reason: item.step.exception.reason,
          grantedAt: item.step.exception.grantedAt,
        }
        : null,
      blockers: item.blockers,
      blockReasons: item.blockers
        .filter((blocker) => !(item.exceptionActive && blocker.exemptable))
        .map((blocker) => blocker.message),
      holdSec: item.step.holdSec,
      riskNote: item.step.riskNote,
    })),
    pendingRelations: plan.pendingRelationSteps.map((item) => ({
      seq: item.step.seq,
      stepId: item.step.id,
      missing: [
        item.blockers.some((blocker) => blocker.code === 'missing-prereq') ? '前置' as const : null,
        item.blockers.some((blocker) => blocker.code === 'missing-member') ? '构件' as const : null,
      ].filter((value): value is '前置' | '构件' => value !== null),
      detail: item.blockers
        .filter((blocker) => blocker.code === 'missing-prereq' || blocker.code === 'missing-member')
        .map((blocker) => blocker.message),
    })),
  }

  downloadJson(
    `装配计划-${jointName}-${new Date().toISOString().slice(0, 10)}.json`,
    payload,
  )
}
