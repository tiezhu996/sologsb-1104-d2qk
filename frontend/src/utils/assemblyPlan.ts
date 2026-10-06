import type { StepException, ValidationCode } from '../types/exception'
import type { Member } from '../types/member'
import type { DisassemblyStep, StepDirection } from '../types/step'

/** 硬性阻挡码：这三类问题未持有效例外时，步骤不能标为可执行 */
export const BLOCKING_CODES: ValidationCode[] = ['dependency-cycle', 'direction-interlock', 'tool-contention']
/** 待补关系码：不阻挡执行，但说明计划关系尚不完整 */
export const PENDING_CODES: ValidationCode[] = ['missing-member', 'missing-prerequisite']

export interface StepIssue {
  code: ValidationCode
  /** 阻挡或待补的具体原因（页面与导出共用这段文字） */
  message: string
  /** 关联的其它步骤号，便于在轨道上定位 */
  relatedSeqs?: number[]
}

export interface StepValidation {
  stepId: string
  issues: StepIssue[]
  blocking: StepIssue[]
  pending: StepIssue[]
  /** 命中且仍有效的老师例外（按校验码索引） */
  activeExceptions: Partial<Record<ValidationCode, StepException>>
  /** 指纹已不符的例外：老师留下的依据在关联内容修改后失效 */
  staleExceptions: StepException[]
  /** 无任何硬性阻挡（含被有效例外放行） */
  executable: boolean
  /** 无阻挡且无待补、无失效例外，关系完整 */
  complete: boolean
}

export interface AssemblyPlanValidation {
  steps: StepValidation[]
  /** 可直接执行的步骤数 */
  executableCount: number
  blockedCount: number
  pendingCount: number
  /** 是否存在失效例外 */
  hasStaleExceptions: boolean
  valid: boolean
}

/** 两个施力方向在同一构件上互斥（互锁关系对称） */
const INTERLOCK_PAIRS: ReadonlyArray<readonly [StepDirection, StepDirection]> = [
  ['轴向', '侧向'],
  ['轴向', '斜向'],
  ['侧向', '斜向'],
]

export function directionsInterlock(a: StepDirection, b: StepDirection): boolean {
  return INTERLOCK_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

/**
 * 步骤关联内容指纹。
 * 只覆盖会影响校验结论的关联信息（关联构件、前置、方向、工具、动作）；
 * 风险提示、停留秒数等不影响阻挡结论的内容不进入指纹。
 * 指纹不含 seq，使老师例外在单纯拖拽调序后仍然有效。
 */
export function stepBasisFingerprint(step: DisassemblyStep): string {
  const memberIds = [...step.memberIds].sort()
  const prerequisiteIds = [...step.prerequisiteIds].sort()
  return [step.action, step.direction, step.tool, memberIds.join('|'), prerequisiteIds.join('|')].join('#')
}

/** Tarjan 求强连通分量：规模大于 1 或存在自环的分量，其成员步骤都处在前置环中 */
function findCycleStepIds(steps: DisassemblyStep[]): Set<string> {
  const byId = new Map(steps.map((step) => [step.id, step]))
  let nextIndex = 0
  const stack: DisassemblyStep[] = []
  const onStack = new Set<string>()
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const cyclic = new Set<string>()

  const strongConnect = (step: DisassemblyStep): void => {
    indices.set(step.id, nextIndex)
    lowLinks.set(step.id, nextIndex)
    nextIndex += 1
    stack.push(step)
    onStack.add(step.id)

    for (const prereqId of step.prerequisiteIds) {
      const prereq = byId.get(prereqId)
      if (!prereq) continue
      if (!indices.has(prereq.id)) {
        strongConnect(prereq)
        lowLinks.set(step.id, Math.min(lowLinks.get(step.id) ?? 0, lowLinks.get(prereq.id) ?? 0))
      } else if (onStack.has(prereq.id)) {
        lowLinks.set(step.id, Math.min(lowLinks.get(step.id) ?? 0, indices.get(prereq.id) ?? 0))
      }
    }

    if (lowLinks.get(step.id) === indices.get(step.id)) {
      const component: DisassemblyStep[] = []
      let current: DisassemblyStep | undefined
      do {
        current = stack.pop()
        if (current) {
          onStack.delete(current.id)
          component.push(current)
        }
      } while (current && current.id !== step.id)

      const selfLoop = component.some((node) => node.prerequisiteIds.includes(node.id))
      if (component.length > 1 || selfLoop) {
        component.forEach((node) => cyclic.add(node.id))
      }
    }
  }

  steps.forEach((step) => {
    if (!indices.has(step.id)) strongConnect(step)
  })
  return cyclic
}

function seqOf(steps: DisassemblyStep[], id: string): number | undefined {
  return steps.find((step) => step.id === id)?.seq
}

/**
 * 校验一份装配计划。
 * @param steps      已按 seq 升序排列的同类型步骤
 * @param members    该类型下仍存在的构件
 * @param exceptions 老师为该类型留下的步骤例外
 */
export function validateAssemblyPlan(
  steps: DisassemblyStep[],
  members: Member[],
  exceptions: StepException[],
): AssemblyPlanValidation {
  const memberIds = new Set(members.map((member) => member.id))
  const cycleIds = findCycleStepIds(steps)

  const validations = steps.map((step, index): StepValidation => {
    const issues: StepIssue[] = []

    // 待补：未关联任何现存构件
    if (step.memberIds.length === 0) {
      issues.push({ code: 'missing-member', message: '待补关系：该步骤尚未关联构件，无法核对施力对象。' })
    } else {
      const vanished = step.memberIds.filter((id) => !memberIds.has(id))
      if (vanished.length > 0) {
        issues.push({ code: 'missing-member', message: '待补关系：关联构件已被移除，需要重新指定本步作用的构件。' })
      }
    }

    // 待补：前置缺失（计划第一步允许从无前置起步）
    if (step.prerequisiteIds.length === 0) {
      if (index > 0) {
        issues.push({
          code: 'missing-prerequisite',
          message: `待补关系：第 ${step.seq} 步未登记前置步骤，学徒无法判断上手依据。`,
        })
      }
    } else {
      const unknown = step.prerequisiteIds.filter((id) => !steps.some((other) => other.id === id))
      if (unknown.length > 0) {
        issues.push({ code: 'missing-prerequisite', message: '待补关系：登记的前置步骤已不存在，需要重新补齐先后关系。' })
      }
    }

    // 阻挡一：前置成环
    if (cycleIds.has(step.id)) {
      const related = step.prerequisiteIds
        .map((id) => seqOf(steps, id))
        .filter((seq): seq is number => typeof seq === 'number')
      issues.push({
        code: 'dependency-cycle',
        message: `前置成环：本步的前置关系首尾相扣（涉及第 ${[...new Set(related)].sort((a, b) => a - b).join('、') || '?'} 步），没有任何一步可以先执行。`,
        relatedSeqs: related,
      })
    }

    // 阻挡二：方向互锁——同一构件上相邻动作施力方向互斥
    const interlockRelated: Array<{ seq: number; other: StepDirection }> = []
    if (step.memberIds.some((id) => memberIds.has(id))) {
      const neighbors = [steps[index - 1], steps[index + 1]].filter((other): other is DisassemblyStep =>
        Boolean(other) && other.id !== step.id)
      for (const neighbor of neighbors) {
        const shared = step.memberIds.filter((id) => neighbor.memberIds.includes(id) && memberIds.has(id))
        if (shared.length > 0 && directionsInterlock(step.direction, neighbor.direction)) {
          interlockRelated.push({ seq: neighbor.seq, other: neighbor.direction })
        }
      }
    }
    if (interlockRelated.length > 0) {
      const related = interlockRelated.map((item) => item.seq).sort((a, b) => a - b)
      const otherDirection = interlockRelated[0]?.other ?? ''
      issues.push({
        code: 'direction-interlock',
        message: `方向互锁：与相邻第 ${related.join('、')} 步在同一构件上施力方向冲突（${step.direction} 与 ${otherDirection} 对撞），强行执行会别伤榫肩。`,
        relatedSeqs: related,
      })
    }

    // 阻挡三：工具冲突——相邻步骤同抢一件手持工具
    const toolNeighbor = steps[index - 1]
    if (toolNeighbor && toolNeighbor.tool === step.tool && toolNeighbor.id !== step.id) {
      issues.push({
        code: 'tool-contention',
        message: `工具冲突：与第 ${toolNeighbor.seq} 步同抢${step.tool}，一件工具无法同时过手，需错开或调整步骤。`,
        relatedSeqs: [toolNeighbor.seq],
      })
    }

    const fingerprint = stepBasisFingerprint(step)
    const ownExceptions = exceptions.filter((item) => item.stepId === step.id)
    const activeExceptions: Partial<Record<ValidationCode, StepException>> = {}
    const staleExceptions: StepException[] = []
    for (const exception of ownExceptions) {
      if (exception.basisFingerprint === fingerprint) {
        activeExceptions[exception.code] = exception
      } else {
        staleExceptions.push(exception)
      }
    }

    const blocking = issues.filter((issue) => BLOCKING_CODES.includes(issue.code))
    const pending = issues.filter((issue) => PENDING_CODES.includes(issue.code))
    const unblocked = blocking.every((issue) => Boolean(activeExceptions[issue.code]))

    return {
      stepId: step.id,
      issues,
      blocking,
      pending,
      activeExceptions,
      staleExceptions,
      executable: unblocked,
      complete: unblocked && blocking.length === 0 && pending.length === 0 && staleExceptions.length === 0,
    }
  })

  const executableCount = validations.filter((item) => item.executable).length
  const blockedCount = validations.filter((item) => item.blocking.some((issue) => !item.activeExceptions[issue.code])).length
  const pendingCount = validations.filter((item) => item.pending.length > 0).length
  const hasStaleExceptions = validations.some((item) => item.staleExceptions.length > 0)

  return {
    steps: validations,
    executableCount,
    blockedCount,
    pendingCount,
    hasStaleExceptions,
    valid: blockedCount === 0 && pendingCount === 0 && !hasStaleExceptions,
  }
}
