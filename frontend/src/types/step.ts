export type StepAction = '拆卸' | '装配'
export type StepDirection = '轴向' | '侧向' | '斜向'
export type StepTool = '木槌' | '鱼线' | '撬板' | '橡胶锤'

export const STEP_ACTIONS: StepAction[] = ['拆卸', '装配']
export const STEP_DIRECTIONS: StepDirection[] = ['轴向', '侧向', '斜向']
export const STEP_TOOLS: StepTool[] = ['木槌', '鱼线', '撬板', '橡胶锤']

/**
 * 老师留下的例外放行：
 * - 只能豁免“冲突类”软阻挡（前置倒置、方向互锁、工具同抢）；
 * - signature 绑定授予时步骤关联的构件 / 方向 / 工具 / 前置，关联内容一改即失效；
 * - 结构类问题（缺构件、缺前置、悬空前置、成环）任何例外都不能放行。
 */
export interface StepException {
  stepId: string
  /** 老师填写的例外依据 */
  reason: string
  grantedAt: string
  /** 授予时刻关联内容的签名，内容变化后签名不再匹配 */
  signature: string
}

export interface DisassemblyStep {
  id: string
  jointTypeId: string
  seq: number
  action: StepAction
  direction: StepDirection
  tool: StepTool
  riskNote: string
  holdSec: number
  /** 关联到的木构件；旧数据缺省，进入“待补关系” */
  memberId?: string
  /** 前置步骤 id 列表（有向无环图的入边） */
  prereqIds?: string[]
  /** 标记为起始步：允许没有前置，不算“缺前置” */
  isStart?: boolean
  /** 老师例外（可能已失效，校验时实时判定） */
  exception?: StepException | null
  schemaRev?: number
}
