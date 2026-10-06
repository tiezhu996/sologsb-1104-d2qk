import type { DisassemblyStep, StepDirection, StepTool } from '../types/step'
import type { Member } from '../types/member'

export type BlockCode =
  | 'missing-prereq'
  | 'dangling-prereq'
  | 'cycle'
  | 'missing-member'
  | 'unresolved-member'
  | 'prereq-order'
  | 'direction-lock'
  | 'tool-conflict'

export interface PlanBlocker {
  code: BlockCode
  message: string
  /** 是否为可被老师例外豁免的冲突类阻挡 */
  exemptable: boolean
  /** 相关步骤 id（前置 / 冲突方），便于页面高亮 */
  relatedStepIds?: string[]
}

export interface PlanStep {
  step: DisassemblyStep
  /** 前置步骤对象（按当前排序），悬空 id 不在其中 */
  prereqs: DisassemblyStep[]
  member?: Member
  blockers: PlanBlocker[]
  /** 存在已生效的老师例外，冲突类阻挡已被豁免 */
  exceptionActive: boolean
  /** 例外失效（关联内容已被修改） */
  exceptionStale: boolean
  executable: boolean
}

export interface AssemblyPlan {
  steps: PlanStep[]
  /** 处于前置环上的步骤 id */
  cycleStepIds: Set<string>
  /** 缺前置、进入“待补关系”的步骤 */
  pendingRelationSteps: PlanStep[]
  executableCount: number
  blockedCount: number
}

/**
 * 方向互锁：同一构件上重复沿同一方向装入，第二次推进会顶死/卡紧先装部分。
 * 拆卸步骤不参与互锁。
 */
const directionLockNote: Record<StepDirection, string> = {
  轴向: '同构件已先沿轴向装入，再沿轴向推进会顶死已装构件',
  侧向: '同构件已先沿侧向装入，侧向再推会形成互锁',
  斜向: '同构件已先沿斜向装入，斜向再次施压会双向卡位',
}

/** 针对同一构件、不能同时使用的工具组合 */
const toolLockGroups: StepTool[][] = [
  ['木槌', '橡胶锤'],
]

function toolsConflict(a: StepTool, b: StepTool): boolean {
  return a === b || toolLockGroups.some((group) => group.includes(a) && group.includes(b))
}

/**
 * 例外签名只覆盖“关联内容”：构件、前置、方向、工具。
 * 排序、风险备注、停留秒数的变化不会让例外失效。
 */
export function exceptionSignature(step: DisassemblyStep): string {
  const prereqIds = [...(step.prereqIds ?? [])].sort()
  return JSON.stringify({
    memberId: step.memberId ?? '',
    prereqIds,
    direction: step.direction,
    tool: step.tool,
  })
}

function findCycleMembers(
  ordered: DisassemblyStep[],
  prereqMap: Map<string, string[]>,
): Set<string> {
  const indexOf = new Map(ordered.map((step, index) => [step.id, index]))
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(ordered.map((step) => [step.id, WHITE]))
  const inCycle = new Set<string>()

  // Tarjan 式染色 DFS：发现回边时沿父链回溯，标出环上节点
  const stack: { id: string; edgeIndex: number }[] = []
  const parent = new Map<string, string>()

  const visitFrom = (startId: string) => {
    color.set(startId, GRAY)
    stack.push({ id: startId, edgeIndex: 0 })
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const edges = prereqMap.get(frame.id) ?? []
      if (frame.edgeIndex < edges.length) {
        const next = edges[frame.edgeIndex++]
        if (!indexOf.has(next)) continue
        const nextColor = color.get(next)
        if (nextColor === WHITE) {
          parent.set(next, frame.id)
          color.set(next, GRAY)
          stack.push({ id: next, edgeIndex: 0 })
        } else if (nextColor === GRAY) {
          // 回边 next -> ... -> frame.id -> next，收集环上节点
          inCycle.add(next)
          let cursor: string | undefined = frame.id
          while (cursor && cursor !== next) {
            inCycle.add(cursor)
            cursor = parent.get(cursor)
          }
          inCycle.add(next)
        }
      } else {
        color.set(frame.id, BLACK)
        stack.pop()
      }
    }
  }

  for (const step of ordered) {
    if (color.get(step.id) === WHITE) visitFrom(step.id)
  }
  return inCycle
}

export function buildAssemblyPlan(
  stepsInput: DisassemblyStep[],
  members: Member[],
): AssemblyPlan {
  const ordered = [...stepsInput].sort((a, b) => a.seq - b.seq)
  const memberById = new Map(members.map((member) => [member.id, member]))
  const stepById = new Map(ordered.map((step) => [step.id, step]))
  const indexById = new Map(ordered.map((step, index) => [step.id, index]))

  const prereqMap = new Map<string, string[]>()
  for (const step of ordered) {
    prereqMap.set(step.id, [...(step.prereqIds ?? [])])
  }

  const cycleMembers = findCycleMembers(ordered, prereqMap)

  // 前置传递闭包：ancestors(id) 为沿前置链必然先完成的所有步骤。
  // 环内前置关系不参与（成环已单独报硬阻挡），避免闭包递归不终止。
  const ancestorCache = new Map<string, Set<string>>()
  const collectAncestors = (id: string, visiting: Set<string>): Set<string> => {
    const cached = ancestorCache.get(id)
    if (cached) return cached
    if (visiting.has(id)) return new Set()
    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    const ancestors = new Set<string>()
    for (const direct of prereqMap.get(id) ?? []) {
      if (!stepById.has(direct)) continue
      ancestors.add(direct)
      for (const upstream of collectAncestors(direct, nextVisiting)) ancestors.add(upstream)
    }
    ancestorCache.set(id, ancestors)
    return ancestors
  }

  const planSteps: PlanStep[] = ordered.map((step) => {
    const blockers: PlanBlocker[] = []
    const addBlocker = (blocker: PlanBlocker) => {
      blockers.push(blocker)
    }

    const prereqs: DisassemblyStep[] = []
    const dangling: string[] = []
    for (const prereqId of step.prereqIds ?? []) {
      const prereq = stepById.get(prereqId)
      if (prereq) prereqs.push(prereq)
      else dangling.push(prereqId)
    }

    // —— 结构类阻挡（不可豁免）——
    const missingPrereq = !step.isStart && (step.prereqIds?.length ?? 0) === 0
    if (missingPrereq) {
      addBlocker({
        code: 'missing-prereq',
        message: '缺前置关系：该步骤未登记任何前置，且未标记为起始步，已进入待补关系。',
        exemptable: false,
      })
    }
    if (dangling.length > 0) {
      addBlocker({
        code: 'dangling-prereq',
        message: `前置步骤已不存在：${dangling.join('、')}，请重新指定前置。`,
        exemptable: false,
      })
    }
    if (cycleMembers.has(step.id)) {
      addBlocker({
        code: 'cycle',
        message: '前置关系成环：沿前置链可回到本步骤，任何一步都无法先行。',
        exemptable: false,
      })
    }
    if (!step.memberId) {
      addBlocker({
        code: 'missing-member',
        message: '缺关联构件：该步骤尚未绑定木构件，已进入待补关系。',
        exemptable: false,
      })
    } else if (!memberById.has(step.memberId)) {
      addBlocker({
        code: 'unresolved-member',
        message: '关联构件已被删除，请重新绑定构件。',
        exemptable: false,
      })
    }

    // —— 冲突类阻挡（可凭生效中的老师例外豁免）——
    const reversedPrereqs = prereqs
      .filter((prereq) => (indexById.get(prereq.id) ?? -1) > (indexById.get(step.id) ?? -1))
      .map((prereq) => prereq.id)
    if (reversedPrereqs.length > 0) {
      const names = reversedPrereqs
        .map((id) => stepById.get(id))
        .filter((item): item is DisassemblyStep => Boolean(item))
        .map((item) => `第${item.seq}步`)
        .join('、')
      addBlocker({
        code: 'prereq-order',
        message: `前置倒置：前置 ${names} 排在本步骤之后。`,
        exemptable: true,
        relatedStepIds: reversedPrereqs,
      })
    }

    // 方向互锁：同构件更早存在同方向的“装配”步即互锁
    if (step.action === '装配' && step.memberId) {
      const lockSteps = ordered
        .slice(0, indexById.get(step.id))
        .filter((earlier) =>
          earlier.action === '装配'
          && earlier.memberId === step.memberId
          && earlier.id !== step.id
          && earlier.direction === step.direction,
        )
      if (lockSteps.length > 0) {
        addBlocker({
          code: 'direction-lock',
          message: `${directionLockNote[step.direction]}（与第 ${lockSteps.map((item) => item.seq).join('、')} 步方向互锁）。`,
          exemptable: true,
          relatedStepIds: lockSteps.map((item) => item.id),
        })
      }
    }

    // 工具同抢：同一构件上，更早一步使用冲突工具且其前置尚未完成到本步之前
    if (step.memberId) {
      const toolRivals = ordered
        .slice(0, indexById.get(step.id))
        .filter((earlier) => earlier.memberId === step.memberId
          && earlier.id !== step.id
          && toolsConflict(earlier.tool, step.tool),
        )
        // 若对方沿前置链必然先完成（直接或传递前置），则是顺序交接，不算同抢
        .filter((earlier) => !collectAncestors(step.id, new Set()).has(earlier.id))
      if (toolRivals.length > 0) {
        addBlocker({
          code: 'tool-conflict',
          message: `工具同抢：第 ${toolRivals.map((item) => item.seq).join('、')} 步在同一构件上占用“${step.tool}”，两件工具不能同时上手。`,
          exemptable: true,
          relatedStepIds: toolRivals.map((item) => item.id),
        })
      }
    }

    const exception = step.exception ?? null
    const exceptionStale = exception !== null
      && exception.signature !== exceptionSignature(step)
    const exceptionActive = exception !== null && !exceptionStale
    const hardBlocked = blockers.some((blocker) => !blocker.exemptable)
    const softBlocked = blockers.some((blocker) => blocker.exemptable)
    const executable = !hardBlocked && (!softBlocked || exceptionActive)

    return {
      step,
      prereqs: prereqs.sort((a, b) => a.seq - b.seq),
      member: step.memberId ? memberById.get(step.memberId) : undefined,
      blockers,
      exceptionActive,
      exceptionStale,
      executable,
    }
  })

  return {
    steps: planSteps,
    cycleStepIds: cycleMembers,
    pendingRelationSteps: planSteps.filter((item) =>
      item.blockers.some((blocker) =>
        blocker.code === 'missing-prereq' || blocker.code === 'missing-member',
      ),
    ),
    executableCount: planSteps.filter((item) => item.executable).length,
    blockedCount: planSteps.filter((item) => !item.executable).length,
  }
}
