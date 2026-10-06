import { VALIDATION_CODE_LABEL, type StepException } from '../types/exception'
import type { Member } from '../types/member'
import { db } from './db'
import { validateAssemblyPlan, type StepValidation } from './assemblyPlan'

export interface MortiseExport {
  exportedAt: string
  joints: unknown[]
  members: unknown[]
  steps: unknown[]
  stepExceptions: unknown[]
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
  const [joints, members, steps, stepExceptions, diagrams, furniture] = await Promise.all([
    db.joints.toArray(),
    db.members.toArray(),
    db.steps.toArray(),
    db.stepExceptions.toArray(),
    db.diagrams.toArray(),
    db.furniture.toArray(),
  ])
  downloadJson(`榫卯图鉴-全部数据-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints,
    members,
    steps,
    stepExceptions,
    diagrams,
    furniture,
  })
}

export async function exportJointData(jointTypeId: string, jointName: string): Promise<void> {
  const [joint, members, steps, stepExceptions, diagrams, furniture] = await Promise.all([
    db.joints.get(jointTypeId),
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.stepExceptions.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
    db.furniture.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  downloadJson(`榫卯图鉴-${jointName}-${new Date().toISOString().slice(0, 10)}.json`, {
    exportedAt: new Date().toISOString(),
    joints: joint ? [joint] : [],
    members,
    steps,
    stepExceptions,
    diagrams,
    furniture,
  })
}

const EXCEPTION_CODE_LABEL = VALIDATION_CODE_LABEL

function planStatus(result: StepValidation): string {
  const unresolvedBlocking = result.blocking.some((issue) => !result.activeExceptions[issue.code])
  if (unresolvedBlocking) return '不可执行'
  if (result.staleExceptions.length > 0) return '例外失效待复核'
  if (result.pending.length > 0) return '可执行（有待补关系）'
  return '可执行'
}

/** 导出一份带构件、前置、方向、工具与阻挡原因的装配计划 */
export async function exportAssemblyPlan(jointTypeId: string, jointName: string): Promise<void> {
  const [joint, members, rawSteps, exceptions] = await Promise.all([
    db.joints.get(jointTypeId),
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).sortBy('seq'),
    db.stepExceptions.where('jointTypeId').equals(jointTypeId).toArray(),
  ])

  const memberById = new Map(members.map((member) => [member.id, member]))
  const stepById = new Map(rawSteps.map((step) => [step.id, step]))
  const plan = validateAssemblyPlan(rawSteps, members, exceptions)

  const planSteps = rawSteps.map((step, index) => {
    const result = plan.steps[index] as StepValidation
    const linkedMembers: Member[] = step.memberIds
      .map((id) => memberById.get(id))
      .filter((member): member is Member => Boolean(member))
    const stepExceptions: StepException[] = exceptions.filter((item) => item.stepId === step.id)

    return {
      seq: step.seq,
      stepId: step.id,
      action: step.action,
      direction: step.direction,
      tool: step.tool,
      holdSec: step.holdSec,
      riskNote: step.riskNote,
      members: linkedMembers.map((member) => ({
        memberId: member.id,
        name: member.name,
        part: member.part,
        grainDir: member.grainDir,
      })),
      missingMemberIds: step.memberIds.filter((id) => !memberById.has(id)),
      prerequisiteSeqs: step.prerequisiteIds
        .map((id) => stepById.get(id)?.seq)
        .filter((seq): seq is number => typeof seq === 'number'),
      missingPrerequisiteIds: step.prerequisiteIds.filter((id) => !stepById.has(id)),
      executable: result.executable,
      status: planStatus(result),
      blockingReasons: result.blocking.map((issue) => ({
        code: issue.code,
        reason: issue.message,
        waived: Boolean(result.activeExceptions[issue.code]),
      })),
      pendingReasons: result.pending.map((issue) => ({
        code: issue.code,
        reason: issue.message,
      })),
      exceptions: stepExceptions.map((exception) => ({
        code: exception.code,
        codeLabel: EXCEPTION_CODE_LABEL[exception.code],
        reason: exception.reason,
        grantedAt: exception.grantedAt,
        valid: Boolean(result.activeExceptions[exception.code]),
      })),
    }
  })

  const payload = {
    exportedAt: new Date().toISOString(),
    docType: 'assembly-plan',
    joint: joint
      ? { id: joint.id, name: joint.name, family: joint.family, difficulty: joint.difficulty }
      : null,
    summary: {
      totalSteps: rawSteps.length,
      executableCount: plan.executableCount,
      blockedCount: plan.blockedCount,
      pendingStepCount: plan.pendingCount,
      hasStaleExceptions: plan.hasStaleExceptions,
      planValid: plan.valid,
    },
    steps: planSteps,
  }

  downloadJson(`装配计划-${jointName}-${new Date().toISOString().slice(0, 10)}.json`, payload)
}
