export type StepAction = '拆卸' | '装配'
export type StepDirection = '轴向' | '侧向' | '斜向'
export type StepTool = '木槌' | '鱼线' | '撬板'

export interface DisassemblyStep {
  id: string
  jointTypeId: string
  seq: number
  action: StepAction
  direction: StepDirection
  tool: StepTool
  riskNote: string
  holdSec: number
  /** 本步关联的构件 id（装配计划 v3 起必填） */
  memberIds: string[]
  /** 前置步骤 id，本步须在所有前置之后执行 */
  prerequisiteIds: string[]
  schemaRev?: number
}
