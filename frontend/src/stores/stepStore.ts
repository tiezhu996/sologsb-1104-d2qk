import { create } from 'zustand'
import type { StepException } from '../types/exception'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'
import { stepBasisFingerprint, validateAssemblyPlan } from '../utils/assemblyPlan'
import { db } from '../utils/db'

export type StepPatch = Partial<Pick<
  DisassemblyStep,
  'action' | 'direction' | 'tool' | 'riskNote' | 'holdSec' | 'memberIds' | 'prerequisiteIds'
>>

export interface RejectedChange {
  kind: 'move' | 'edit'
  /** 被阻挡、未能提交的原因（供页面横幅展示） */
  reasons: string[]
  stepLabels: number[]
}

interface StepState {
  steps: DisassemblyStep[]
  currentStepIndex: number
  loading: boolean
  /** 最近一次被校验拦下、已回滚到改动前的改动 */
  rejection: RejectedChange | null
  loadSteps: (jointTypeId: string) => Promise<void>
  moveStep: (jointTypeId: string, from: number, to: number, members: Member[], exceptions: StepException[]) => Promise<boolean>
  saveStep: (jointTypeId: string, stepId: string, patch: StepPatch, members: Member[], exceptions: StepException[]) => Promise<boolean>
  setCurrentStep: (index: number) => void
  dismissRejection: () => void
}

/**
 * 提交一份新的计划顺序/内容。
 * 校验未通过（存在未被有效例外放行的硬性阻挡）时：
 * 步骤顺序、步骤内容以及老师例外状态都回到改动前——即不写入任何数据。
 * 校验通过时，关联内容变化导致指纹不符的失效例外在同一事务中清除。
 */
async function commitPlan(
  jointTypeId: string,
  candidate: DisassemblyStep[],
  members: Member[],
  exceptions: StepException[],
): Promise<{ ok: boolean; rejection: RejectedChange | null; retainedExceptionIds: string[] }> {
  const validation = validateAssemblyPlan(candidate, members, exceptions)
  const blocked = validation.steps.filter((item) =>
    item.blocking.some((issue) => !item.activeExceptions[issue.code]))

  if (blocked.length > 0) {
    const byId = new Map(candidate.map((step) => [step.id, step]))
    return {
      ok: false,
      retainedExceptionIds: [],
      rejection: {
        kind: 'move',
        reasons: blocked.flatMap((item) =>
          item.blocking
            .filter((issue) => !item.activeExceptions[issue.code])
            .map((issue) => issue.message)),
        stepLabels: blocked
          .map((item) => byId.get(item.stepId)?.seq ?? 0)
          .filter((seq) => seq > 0),
      },
    }
  }

  const candidateById = new Map(candidate.map((step) => [step.id, step]))
  const retainedExceptions = exceptions.filter((exception) => {
    const step = candidateById.get(exception.stepId)
    return Boolean(step) && stepBasisFingerprint(step as DisassemblyStep) === exception.basisFingerprint
  })
  const retainedIds = new Set(retainedExceptions.map((exception) => exception.id))

  await db.transaction('rw', [db.steps, db.stepExceptions], async () => {
    await db.steps.bulkPut(candidate)
    const owned = await db.stepExceptions.where('jointTypeId').equals(jointTypeId).toArray()
    const removed = owned.filter((item) => !retainedIds.has(item.id)).map((item) => item.id)
    if (removed.length > 0) await db.stepExceptions.bulkDelete(removed)
  })

  return { ok: true, rejection: null, retainedExceptionIds: [...retainedIds] }
}

export const useStepStore = create<StepState>((set, get) => ({
  steps: [],
  currentStepIndex: 0,
  loading: false,
  rejection: null,

  loadSteps: async (jointTypeId) => {
    set({ loading: true, rejection: null })
    try {
      const steps = await db.steps.where('jointTypeId').equals(jointTypeId).sortBy('seq')
      set((state) => ({
        steps,
        currentStepIndex: Math.min(state.currentStepIndex, Math.max(0, steps.length - 1)),
      }))
    } finally {
      set({ loading: false })
    }
  },

  moveStep: async (jointTypeId, from, to, members, exceptions) => {
    const ordered = [...get().steps]
      .filter((step) => step.jointTypeId === jointTypeId)
      .sort((a, b) => a.seq - b.seq)
    if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length || from === to) return true
    const [moved] = ordered.splice(from, 1)
    if (!moved) return true
    ordered.splice(to, 0, moved)
    const candidate = ordered.map((step, index) => ({ ...step, seq: index + 1 }))

    const result = await commitPlan(jointTypeId, candidate, members, exceptions)
    if (!result.ok) {
      // 校验失败：顺序不写入，状态停留在改动前
      set({ rejection: { ...(result.rejection as RejectedChange), kind: 'move' } })
      return false
    }
    set({ steps: candidate, currentStepIndex: to, rejection: null })
    return true
  },

  saveStep: async (jointTypeId, stepId, patch, members, exceptions) => {
    const ordered = [...get().steps]
      .filter((step) => step.jointTypeId === jointTypeId)
      .sort((a, b) => a.seq - b.seq)
    const index = ordered.findIndex((step) => step.id === stepId)
    if (index < 0) return false
    const previous = ordered[index] as DisassemblyStep
    const next: DisassemblyStep = {
      ...previous,
      ...patch,
      memberIds: patch.memberIds ?? previous.memberIds,
      prerequisiteIds: patch.prerequisiteIds ?? previous.prerequisiteIds,
    }
    const candidate = ordered.map((step) => (step.id === stepId ? next : step))

    const result = await commitPlan(jointTypeId, candidate, members, exceptions)
    if (!result.ok) {
      // 校验失败：步骤内容与例外状态都回到改动前
      set({ rejection: { ...(result.rejection as RejectedChange), kind: 'edit' } })
      return false
    }
    set((state) => ({
      steps: state.steps.map((step) => (step.id === stepId ? next : step)),
      rejection: null,
    }))
    return true
  },

  setCurrentStep: (index) => set({
    currentStepIndex: Math.max(0, index),
  }),

  dismissRejection: () => set({ rejection: null }),
}))
