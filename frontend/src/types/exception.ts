/** 装配计划校验码：前三项为硬性阻挡，后两项为待补关系 */
export type ValidationCode =
  | 'dependency-cycle'
  | 'direction-interlock'
  | 'tool-contention'
  | 'missing-member'
  | 'missing-prerequisite'

/** 单个老师例外：针对某一步的某条校验码放行 */
export interface StepException {
  id: string
  jointTypeId: string
  stepId: string
  code: ValidationCode
  reason: string
  grantedAt: string
  /** 授予时关联内容的指纹；关联改动后指纹不符，例外自动失效 */
  basisFingerprint: string
  schemaRev?: number
}

export const VALIDATION_CODE_LABEL: Record<ValidationCode, string> = {
  'dependency-cycle': '前置成环',
  'direction-interlock': '方向互锁',
  'tool-contention': '工具冲突',
  'missing-member': '缺关联构件',
  'missing-prerequisite': '缺前置步骤',
}
