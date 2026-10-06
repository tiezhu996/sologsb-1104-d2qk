import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { useExceptionStore } from './exceptionStore'
import { useStepStore } from './stepStore'
import { db } from '../utils/db'
import { stepBasisFingerprint } from '../utils/assemblyPlan'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'

const JOINT = 'j-plan-test'

function member(id: string): Member {
  return {
    id, jointTypeId: JOINT, name: '榫头', part: '出榫件', grainDir: '顺纹',
    lengthMm: 100, widthMm: 40, thicknessMm: 20, toleranceMm: 0.15, note: '',
  }
}

function step(id: string, seq: number, patch: Partial<DisassemblyStep> = {}): DisassemblyStep {
  return {
    id,
    jointTypeId: JOINT,
    seq,
    action: '拆卸',
    direction: '轴向',
    tool: '木槌',
    riskNote: '',
    holdSec: 5,
    memberIds: ['m-a'],
    prerequisiteIds: seq === 1 ? [] : [`s-${seq - 1}`],
    ...patch,
  }
}

async function seed(): Promise<{ members: Member[]; steps: DisassemblyStep[] }> {
  const members = [member('m-a'), member('m-b'), member('m-c')]
  const steps = [
    step('s-1', 1, { tool: '木槌', direction: '轴向', memberIds: ['m-a'] }),
    step('s-2', 2, { tool: '鱼线', direction: '侧向', memberIds: ['m-b'] }),
    step('s-3', 3, { tool: '撬板', direction: '斜向', memberIds: ['m-c'] }),
  ]
  await db.members.bulkPut(members)
  await db.steps.bulkPut(steps)
  await useStepStore.getState().loadSteps(JOINT)
  await useExceptionStore.getState().loadExceptions(JOINT)
  return { members, steps }
}

beforeEach(async () => {
  useStepStore.setState({ steps: [], currentStepIndex: 0, loading: false, rejection: null })
  useExceptionStore.setState({ exceptions: [], loading: false })
  await db.transaction('rw', [db.steps, db.members, db.stepExceptions], async () => {
    await db.steps.where('jointTypeId').equals(JOINT).delete()
    await db.members.where('jointTypeId').equals(JOINT).delete()
    await db.stepExceptions.where('jointTypeId').equals(JOINT).delete()
  })
})

describe('stepStore · 调序事务', () => {
  it('会引发工具冲突的拖动被拒绝：返回 false、给出原因，顺序与数据库都回到改动前', async () => {
    const { members, steps } = await seed()
    const exceptions = useExceptionStore.getState().exceptions
    // 让第 3 步也用木槌：把它拖到第 1 步后面会与第 1 步同抢木槌
    await db.steps.put({ ...(steps[2] as DisassemblyStep), tool: '木槌' })
    await useStepStore.getState().loadSteps(JOINT)

    const before = (await db.steps.where('jointTypeId').equals(JOINT).sortBy('seq')).map((s) => s.id)
    const ok = await useStepStore.getState().moveStep(JOINT, 2, 1, members, exceptions)
    const after = (await db.steps.where('jointTypeId').equals(JOINT).sortBy('seq')).map((s) => s.id)

    expect(ok).toBe(false)
    expect(after).toEqual(before)
    expect(useStepStore.getState().steps.map((s) => s.seq)).toEqual([1, 2, 3])
    expect(useStepStore.getState().rejection?.kind).toBe('move')
    expect(useStepStore.getState().rejection?.reasons.join(' ')).toContain('工具冲突')
  })

  it('不产生阻挡的拖动正常落库并重排步号', async () => {
    const { members } = await seed()
    const exceptions = useExceptionStore.getState().exceptions
    const ok = await useStepStore.getState().moveStep(JOINT, 2, 0, members, exceptions)
    expect(ok).toBe(true)
    const after = await db.steps.where('jointTypeId').equals(JOINT).sortBy('seq')
    expect(after.map((s) => s.id)).toEqual(['s-3', 's-1', 's-2'])
    expect(after.map((s) => s.seq)).toEqual([1, 2, 3])
  })
})

describe('stepStore · 编辑事务', () => {
  it('编辑引入方向互锁时被拒绝：步骤内容与例外状态回到改动前', async () => {
    const { members } = await seed()
    const exceptions = useExceptionStore.getState().exceptions
    // 第 2 步原本侧向、作用 m-b；改成与第 1 步同构件且异向相邻 → 方向互锁
    const ok = await useStepStore.getState().saveStep(
      JOINT,
      's-2',
      { direction: '侧向', memberIds: ['m-a'] },
      members,
      exceptions,
    )
    expect(ok).toBe(false)
    const stored = await db.steps.get('s-2')
    expect(stored?.memberIds).toEqual(['m-b'])
    expect(useStepStore.getState().rejection?.reasons.join(' ')).toContain('方向互锁')
  })

  it('前置改成成环时被拒绝，前置关系维持原值', async () => {
    const { members } = await seed()
    const exceptions = useExceptionStore.getState().exceptions
    // s1 → s3 → s2 → s1：把 s-1 的前置指向 s-3，形成三环
    const ok = await useStepStore.getState().saveStep(
      JOINT,
      's-1',
      { prerequisiteIds: ['s-3'] },
      members,
      exceptions,
    )
    expect(ok).toBe(false)
    const stored = await db.steps.get('s-1')
    expect(stored?.prerequisiteIds).toEqual([])
    expect(useStepStore.getState().rejection?.reasons.join(' ')).toContain('前置成环')
  })
})

describe('stepStore · 老师例外失效', () => {
  it('关联内容修改后，旧依据的例外在成功提交的同一事务中被删除', async () => {
    const { members, steps } = await seed()
    // 制造相邻同工具冲突：s-2 改用木槌
    await db.steps.put({ ...(steps[1] as DisassemblyStep), tool: '木槌' })
    await useStepStore.getState().loadSteps(JOINT)
    const currentS2 = (await db.steps.get('s-2')) as DisassemblyStep

    // 老师为 s-2 的工具冲突登记例外
    await useExceptionStore.getState().grantException({
      jointTypeId: JOINT,
      stepId: 's-2',
      code: 'tool-contention',
      reason: '现场备有两把木槌',
      basisFingerprint: stepBasisFingerprint(currentS2),
    })
    const exceptionsAfterGrant = await db.stepExceptions.where('jointTypeId').equals(JOINT).toArray()
    expect(exceptionsAfterGrant).toHaveLength(1)

    // 学徒随后把 s-2 的工具改为鱼线：冲突消失，保存通过；但关联内容已变，旧依据必须失效
    const ok = await useStepStore.getState().saveStep(
      JOINT,
      's-2',
      { tool: '鱼线' },
      members,
      useExceptionStore.getState().exceptions,
    )
    expect(ok).toBe(true)
    const remaining = await db.stepExceptions.where('jointTypeId').equals(JOINT).toArray()
    expect(remaining).toHaveLength(0)
  })

  it('仅拖拽改步号不改变依据指纹，例外仍然保留', async () => {
    const { members, steps } = await seed()
    await useExceptionStore.getState().grantException({
      jointTypeId: JOINT,
      stepId: 's-2',
      code: 'tool-contention',
      reason: '老师确认',
      basisFingerprint: stepBasisFingerprint(steps[1] as DisassemblyStep),
    })
    const ok = await useStepStore.getState().moveStep(
      JOINT,
      0,
      1,
      members,
      useExceptionStore.getState().exceptions,
    )
    expect(ok).toBe(true)
    const remaining = await db.stepExceptions.where('jointTypeId').equals(JOINT).toArray()
    expect(remaining).toHaveLength(1)
  })
})
