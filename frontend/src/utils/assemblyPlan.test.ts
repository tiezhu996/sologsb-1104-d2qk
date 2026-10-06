import { describe, expect, it } from 'vitest'
import {
  BLOCKING_CODES,
  PENDING_CODES,
  directionsInterlock,
  stepBasisFingerprint,
  validateAssemblyPlan,
} from './assemblyPlan'
import type { Member } from '../types/member'
import type { DisassemblyStep, StepDirection, StepTool } from '../types/step'
import type { StepAction } from '../types/step'
import type { StepException, ValidationCode } from '../types/exception'

function makeMembers(): Member[] {
  return ['m-a', 'm-b', 'm-c'].map((id) => ({
    id,
    jointTypeId: 'j1',
    name: '榫头',
    part: '出榫件',
    grainDir: '顺纹',
    lengthMm: 100,
    widthMm: 40,
    thicknessMm: 20,
    toleranceMm: 0.15,
    note: '',
  }))
}

interface StepOptions {
  seq: number
  direction?: StepDirection
  tool?: StepTool
  memberIds?: string[]
  prerequisiteIds?: string[]
  action?: StepAction
}

function makeStep(id: string, options: StepOptions): DisassemblyStep {
  return {
    id,
    jointTypeId: 'j1',
    seq: options.seq,
    action: options.action ?? (options.seq === 3 ? '装配' : '拆卸'),
    direction: options.direction ?? '轴向',
    tool: options.tool ?? '木槌',
    riskNote: '',
    holdSec: 5,
    memberIds: options.memberIds ?? ['m-a'],
    prerequisiteIds: options.prerequisiteIds ?? (options.seq === 1 ? [] : [`s${options.seq - 1}`]),
  }
}

function makeException(step: DisassemblyStep, code: ValidationCode, basisOverride?: Partial<DisassemblyStep>): StepException {
  return {
    id: `exc-${step.id}-${code}`,
    jointTypeId: step.jointTypeId,
    stepId: step.id,
    code,
    reason: '老师现场确认',
    grantedAt: '2026-10-01T00:00:00.000Z',
    basisFingerprint: stepBasisFingerprint(basisOverride ? { ...step, ...basisOverride } : step),
  }
}

describe('directionsInterlock', () => {
  it('同向与施力方向不互锁，异向两两极锁', () => {
    expect(directionsInterlock('轴向', '轴向')).toBe(false)
    expect(directionsInterlock('轴向', '侧向')).toBe(true)
    expect(directionsInterlock('斜向', '轴向')).toBe(true)
    expect(directionsInterlock('侧向', '斜向')).toBe(true)
    expect(directionsInterlock('侧向', '轴向')).toBe(true)
  })
})

describe('validateAssemblyPlan · 基线计划', () => {
  it('关系完整、无相邻冲突时所有步骤可执行', () => {
    const steps = [
      makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, direction: '侧向', tool: '鱼线', memberIds: ['m-b'] }),
      makeStep('s3', { seq: 3, direction: '斜向', tool: '撬板', memberIds: ['m-c'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.valid).toBe(true)
    expect(plan.executableCount).toBe(3)
    expect(plan.blockedCount).toBe(0)
    expect(plan.pendingCount).toBe(0)
    expect(plan.steps.every((item) => item.complete)).toBe(true)
  })
})

describe('validateAssemblyPlan · 待补关系', () => {
  it('旧步骤未关联构件、非首步未登记前置时进入待补，但不阻挡执行', () => {
    const steps = [
      makeStep('s1', { seq: 1, memberIds: [], tool: '木槌' }),
      makeStep('s2', { seq: 2, memberIds: [], prerequisiteIds: [], tool: '鱼线' }),
      makeStep('s3', { seq: 3, tool: '撬板' }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    const [first, second] = plan.steps
    expect(first?.pending.map((issue) => issue.code)).toContain('missing-member')
    expect(first?.executable).toBe(true)
    expect(second?.pending.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing-member', 'missing-prerequisite']),
    )
    expect(second?.executable).toBe(true)
    expect(plan.blockedCount).toBe(0)
    expect(plan.pendingCount).toBe(2)
    expect(plan.valid).toBe(false)
  })

  it('首步无前置不算待补；指向已删除前置、已删除构件也要待补', () => {
    const steps = [
      makeStep('s1', { seq: 1, memberIds: ['m-gone'], prerequisiteIds: [] }),
      makeStep('s2', { seq: 2, prerequisiteIds: ['s-gone'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    const [first, second] = plan.steps
    expect(first?.pending.map((issue) => issue.code)).toEqual(['missing-member'])
    expect(second?.pending.map((issue) => issue.code)).toEqual(['missing-prerequisite'])
  })
})

describe('validateAssemblyPlan · 前置成环', () => {
  it('前置首尾相扣时环上节点都不可执行，并写清涉及步号', () => {
    const steps = [
      makeStep('s1', { seq: 1, prerequisiteIds: ['s3'], tool: '木槌' }),
      makeStep('s2', { seq: 2, prerequisiteIds: ['s1'], tool: '鱼线' }),
      makeStep('s3', { seq: 3, prerequisiteIds: ['s2'], tool: '撬板' }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.blockedCount).toBe(3)
    expect(plan.steps.every((item) => !item.executable)).toBe(true)
    const cycleIssue = plan.steps[0]?.blocking.find((issue) => issue.code === 'dependency-cycle')
    expect(cycleIssue?.message).toContain('前置成环')
    expect(cycleIssue?.relatedSeqs).toEqual(expect.arrayContaining([3]))
  })

  it('自环也判定为成环', () => {
    const steps = [
      makeStep('s1', { seq: 1, prerequisiteIds: ['s1'], tool: '木槌' }),
      makeStep('s2', { seq: 2, prerequisiteIds: ['s1'], tool: '鱼线' }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.steps[0]?.blocking.some((issue) => issue.code === 'dependency-cycle')).toBe(true)
    expect(plan.steps[1]?.blocking.some((issue) => issue.code === 'dependency-cycle')).toBe(false)
    expect(plan.blockedCount).toBe(1)
  })
})

describe('validateAssemblyPlan · 方向互锁', () => {
  it('同一构件上相邻异向动作双向互锁，不相邻不互锁', () => {
    const steps = [
      makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, direction: '侧向', tool: '鱼线', memberIds: ['m-a'] }),
      makeStep('s3', { seq: 3, direction: '轴向', tool: '撬板', memberIds: ['m-a'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.steps[0]?.blocking.map((issue) => issue.code)).toEqual(['direction-interlock'])
    expect(plan.steps[1]?.blocking.map((issue) => issue.code)).toEqual(['direction-interlock'])
    expect(plan.steps[1]?.blocking[0]?.relatedSeqs).toEqual([1, 3])
    expect(plan.steps[2]?.blocking.map((issue) => issue.code)).toEqual(['direction-interlock'])
    expect(plan.blockedCount).toBe(3)
  })

  it('方向冲突但作用于不同构件时不算互锁', () => {
    const steps = [
      makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, direction: '侧向', tool: '鱼线', memberIds: ['m-b'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.blockedCount).toBe(0)
  })
})

describe('validateAssemblyPlan · 工具冲突', () => {
  it('相邻步骤同抢一件工具时后一步不可执行', () => {
    const steps = [
      makeStep('s1', { seq: 1, tool: '木槌', direction: '轴向', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, tool: '木槌', direction: '侧向', memberIds: ['m-b'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.steps[0]?.blocking.some((issue) => issue.code === 'tool-contention')).toBe(false)
    expect(plan.steps[1]?.blocking.map((issue) => issue.code)).toContain('tool-contention')
    expect(plan.steps[1]?.blocking.find((issue) => issue.code === 'tool-contention')?.message).toContain('同抢木槌')
    expect(plan.blockedCount).toBe(1)
  })

  it('工具相同但中间隔一步不冲突', () => {
    const steps = [
      makeStep('s1', { seq: 1, tool: '木槌', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, tool: '鱼线', memberIds: ['m-b'] }),
      makeStep('s3', { seq: 3, tool: '木槌', memberIds: ['m-c'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [])
    expect(plan.blockedCount).toBe(0)
  })
})

describe('validateAssemblyPlan · 老师例外', () => {
  it('持有与当前内容指纹一致的例外时，对应阻挡被放行', () => {
    const steps = [
      makeStep('s1', { seq: 1, prerequisiteIds: ['s2'], tool: '木槌' }),
      makeStep('s2', { seq: 2, prerequisiteIds: ['s1'], tool: '鱼线' }),
    ]
    const exceptions = [makeException(steps[0] as DisassemblyStep, 'dependency-cycle')]
    const plan = validateAssemblyPlan(steps, makeMembers(), exceptions)
    // 成环是双方问题：只给 s1 放行，s2 仍被阻挡；s1 自身 executable
    expect(plan.steps[0]?.executable).toBe(true)
    expect(plan.steps[0]?.activeExceptions['dependency-cycle']).toBeTruthy()
    expect(plan.steps[1]?.executable).toBe(false)
  })

  it('例外只放行对应校验码，其它阻挡仍然生效', () => {
    const steps = [
      makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌', memberIds: ['m-a'] }),
      makeStep('s2', { seq: 2, direction: '侧向', tool: '木槌', memberIds: ['m-a'] }),
    ]
    const exceptions = [makeException(steps[1] as DisassemblyStep, 'tool-contention')]
    const plan = validateAssemblyPlan(steps, makeMembers(), exceptions)
    const second = plan.steps[1]
    expect(second?.activeExceptions['tool-contention']).toBeTruthy()
    expect(second?.executable).toBe(false)
    expect(second?.blocking.some((issue) => issue.code === 'direction-interlock' && !second.activeExceptions[issue.code])).toBe(true)
  })

  it('关联内容修改后指纹不符，例外自动失效且步骤恢复阻挡', () => {
    const savedStep = makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌', memberIds: ['m-a'] })
    const exception = makeException(savedStep, 'direction-interlock')
    // 老师授权后，学徒改了关联构件
    const changedStep = { ...savedStep, memberIds: ['m-b'] }
    const steps = [
      changedStep,
      makeStep('s2', { seq: 2, direction: '侧向', tool: '鱼线', memberIds: ['m-b'] }),
    ]
    const plan = validateAssemblyPlan(steps, makeMembers(), [exception])
    const first = plan.steps[0]
    expect(first?.staleExceptions).toHaveLength(1)
    expect(Object.keys(first?.activeExceptions ?? {})).toHaveLength(0)
    expect(first?.executable).toBe(false)
    expect(plan.hasStaleExceptions).toBe(true)
    expect(plan.valid).toBe(false)
  })

  it('单纯拖拽改步号（seq）不会使例外失效', () => {
    const step = makeStep('s1', { seq: 1, direction: '轴向', tool: '木槌' })
    const exception = makeException(step, 'dependency-cycle')
    const reordered = { ...step, seq: 2 }
    const plan = validateAssemblyPlan([reordered], makeMembers(), [exception])
    expect(plan.steps[0]?.staleExceptions).toHaveLength(0)
    expect(plan.steps[0]?.activeExceptions['dependency-cycle']).toBeTruthy()
  })

  it('指纹对 action/方向/工具/构件/前置的变化敏感，对风险提示与停留秒数不敏感', () => {
    const step = makeStep('s1', { seq: 1 })
    expect(stepBasisFingerprint({ ...step, riskNote: '换了提醒', holdSec: 99 })).toBe(stepBasisFingerprint(step))
    expect(stepBasisFingerprint({ ...step, tool: '鱼线' })).not.toBe(stepBasisFingerprint(step))
    expect(stepBasisFingerprint({ ...step, direction: '斜向' })).not.toBe(stepBasisFingerprint(step))
    expect(stepBasisFingerprint({ ...step, memberIds: ['m-b'] })).not.toBe(stepBasisFingerprint(step))
    expect(stepBasisFingerprint({ ...step, prerequisiteIds: ['s9'] })).not.toBe(stepBasisFingerprint(step))
  })
})

describe('校验码分组', () => {
  it('阻挡码与待补码互不重叠', () => {
    expect(new Set([...BLOCKING_CODES, ...PENDING_CODES]).size).toBe(BLOCKING_CODES.length + PENDING_CODES.length)
  })
})
