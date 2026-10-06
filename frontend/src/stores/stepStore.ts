import { create } from 'zustand'
import type { DisassemblyStep, StepException } from '../types/step'
import { exceptionSignature } from '../utils/assemblyPlan'
import { db } from '../utils/db'

export interface StepRelationsPatch {
  memberId?: string | null
  prereqIds?: string[]
  isStart?: boolean
  direction?: DisassemblyStep['direction']
  tool?: DisassemblyStep['tool']
}

interface StepState {
  steps: DisassemblyStep[]
  currentStepIndex: number
  loading: boolean
  /** 最近一次被拒绝的改动及原因，供页面提示 */
  lastRejection: string | null
  loadSteps: (jointTypeId: string) => Promise<void>
  moveStep: (from: number, to: number) => Promise<boolean>
  /** 修改关联内容；结构性校验失败时顺序与例外状态整体回滚 */
  updateStepRelations: (stepId: string, patch: StepRelationsPatch) => Promise<boolean>
  /** 老师为冲突类阻挡留下例外依据 */
  grantException: (stepId: string, reason: string) => Promise<boolean>
  clearException: (stepId: string) => Promise<void>
  dismissRejection: () => void
  setCurrentStep: (index: number) => void
}

/** 判断前置图是否成环；返回环上任意节点 id，无环返回 null */
function detectCycle(steps: DisassemblyStep[]): string | null {
  const ids = new Set(steps.map((step) => step.id))
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(steps.map((step) => [step.id, WHITE]))

  const walk = (id: string, stack: string[]): string | null => {
    color.set(id, GRAY)
    const step = steps.find((item) => item.id === id)
    for (const prereqId of step?.prereqIds ?? []) {
      if (!ids.has(prereqId)) continue
      const nextColor = color.get(prereqId)
      if (nextColor === GRAY) {
        return [...stack, id, prereqId].join(' → ')
      }
      if (nextColor === WHITE) {
        const found = walk(prereqId, [...stack, id])
        if (found) return found
      }
    }
    color.set(id, BLACK)
    return null
  }

  for (const step of steps) {
    if (color.get(step.id) === WHITE) {
      const found = walk(step.id, [])
      if (found) return found
    }
  }
  return null
}

function describeCycle(chain: string, steps: DisassemblyStep[]): string {
  const seqOf = new Map(steps.map((step) => [step.id, step.seq]))
  const seqText = chain
    .split(' → ')
    .map((id) => (seqOf.has(id) ? `第${seqOf.get(id)}步` : id))
    .join(' → ')
  return `前置成环（${seqText}），节点不能标为可执行，顺序未改动。`
}

export const useStepStore = create<StepState>((set, get) => ({
  steps: [],
  currentStepIndex: 0,
  loading: false,
  lastRejection: null,

  loadSteps: async (jointTypeId) => {
    set({ loading: true })
    try {
      const steps = await db.steps.where('jointTypeId').equals(jointTypeId).sortBy('seq')
      set((state) => ({
        steps,
        currentStepIndex: Math.min(state.currentStepIndex, Math.max(0, steps.length - 1)),
        lastRejection: null,
      }))
    } finally {
      set({ loading: false })
    }
  },

  moveStep: async (from, to) => {
    const ordered = [...get().steps].sort((a, b) => a.seq - b.seq)
    if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length || from === to) return false

    // 改动前快照；环校验失败后顺序与例外状态全部回到改动前
    const snapshot = ordered.map((step) => ({ ...step }))
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    if (!moved) return false
    next.splice(to, 0, moved)
    const resequenced = next.map((step, index) => ({ ...step, seq: index + 1 }))

    const cycle = detectCycle(resequenced)
    if (cycle) {
      set({ lastRejection: describeCycle(cycle, resequenced) })
      return false
    }

    // 乐观更新；落库失败同样回滚到快照
    set({ steps: resequenced, currentStepIndex: to, lastRejection: null })
    try {
      await db.steps.bulkPut(resequenced)
      return true
    } catch (error) {
      set({
        steps: snapshot,
        currentStepIndex: from,
        lastRejection: `保存失败，顺序已恢复：${error instanceof Error ? error.message : '未知错误'}`,
      })
      return false
    }
  },

  updateStepRelations: async (stepId, patch) => {
    const current = get().steps
    const snapshot = current.map((step) => ({ ...step }))
    const index = current.findIndex((step) => step.id === stepId)
    if (index === -1) return false
    const target = current[index]

    const updatedStep: DisassemblyStep = {
      ...target,
      memberId: patch.memberId === undefined
        ? target.memberId
        : (patch.memberId ?? undefined),
      prereqIds: patch.prereqIds === undefined ? target.prereqIds : patch.prereqIds,
      isStart: patch.isStart === undefined ? target.isStart : patch.isStart,
      direction: patch.direction ?? target.direction,
      tool: patch.tool ?? target.tool,
    }

    // 不允许自引用前置
    if ((updatedStep.prereqIds ?? []).includes(stepId)) {
      set({ lastRejection: '不能把本步骤登记为自己的前置，修改未保存。' })
      return false
    }

    // 关联内容修改后，老师留下的例外依据立即失效并移除
    const exceptionWillExpire = updatedStep.exception
      && updatedStep.exception.signature !== exceptionSignature(updatedStep)
    if (exceptionWillExpire) {
      updatedStep.exception = null
    }

    const candidate = current.map((step) => (step.id === stepId ? updatedStep : step))
    const cycle = detectCycle(candidate)
    if (cycle) {
      // 校验失败：顺序与例外状态回到改动前（快照不动）
      set({ lastRejection: describeCycle(cycle, candidate) })
      return false
    }

    set({ steps: candidate, lastRejection: null })
    try {
      await db.steps.put(updatedStep)
      return true
    } catch (error) {
      set({
        steps: snapshot,
        lastRejection: `保存失败，关联与例外状态已恢复：${error instanceof Error ? error.message : '未知错误'}`,
      })
      return false
    }
  },

  grantException: async (stepId, reason) => {
    const trimmed = reason.trim()
    if (!trimmed) {
      set({ lastRejection: '例外依据必须写明理由，未留空放行。' })
      return false
    }
    const current = get().steps
    const target = current.find((step) => step.id === stepId)
    if (!target) return false

    const exception: StepException = {
      stepId,
      reason: trimmed,
      grantedAt: new Date().toISOString(),
      signature: exceptionSignature(target),
    }
    const updated: DisassemblyStep = { ...target, exception }
    const next = current.map((step) => (step.id === stepId ? updated : step))
    set({ steps: next, lastRejection: null })
    try {
      await db.steps.put(updated)
      return true
    } catch (error) {
      set({
        steps: current.map((step) => ({ ...step })),
        lastRejection: `例外保存失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
      return false
    }
  },

  clearException: async (stepId) => {
    const current = get().steps
    const target = current.find((step) => step.id === stepId)
    if (!target?.exception) return
    const updated: DisassemblyStep = { ...target, exception: null }
    const next = current.map((step) => (step.id === stepId ? updated : step))
    set({ steps: next, lastRejection: null })
    await db.steps.put(updated)
  },

  dismissRejection: () => set({ lastRejection: null }),

  setCurrentStep: (index) => set({
    currentStepIndex: Math.max(0, index),
  }),
}))
