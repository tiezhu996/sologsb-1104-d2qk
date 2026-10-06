import { useCallback, useEffect, useMemo } from 'react'
import { useExceptionStore } from '../stores/exceptionStore'
import { useJointStore } from '../stores/jointStore'
import { useStepStore, type StepPatch } from '../stores/stepStore'
import { stepBasisFingerprint, validateAssemblyPlan } from '../utils/assemblyPlan'
import type { DisassemblyStep } from '../types/step'
import type { Member } from '../types/member'
import type { ValidationCode } from '../types/exception'

export interface AssemblyPlanStep {
  step: DisassemblyStep
  index: number
}

export function useAssemblyPlan(jointTypeId: string) {
  const allSteps = useStepStore((state) => state.steps)
  const currentStepIndex = useStepStore((state) => state.currentStepIndex)
  const rejection = useStepStore((state) => state.rejection)
  const loadSteps = useStepStore((state) => state.loadSteps)
  const moveStep = useStepStore((state) => state.moveStep)
  const saveStep = useStepStore((state) => state.saveStep)
  const setCurrentStep = useStepStore((state) => state.setCurrentStep)
  const dismissRejection = useStepStore((state) => state.dismissRejection)

  const members = useJointStore((state) => state.members)
  const loadAll = useJointStore((state) => state.loadAll)

  const exceptions = useExceptionStore((state) => state.exceptions)
  const loadExceptions = useExceptionStore((state) => state.loadExceptions)
  const grantException = useExceptionStore((state) => state.grantException)
  const revokeException = useExceptionStore((state) => state.revokeException)

  useEffect(() => {
    if (!jointTypeId) return
    void loadAll()
    void loadSteps(jointTypeId)
    void loadExceptions(jointTypeId)
  }, [jointTypeId, loadAll, loadSteps, loadExceptions])

  const steps = useMemo(
    () => allSteps
      .filter((step) => step.jointTypeId === jointTypeId)
      .sort((a, b) => a.seq - b.seq),
    [allSteps, jointTypeId],
  )

  const jointMembers = useMemo(
    () => members.filter((member) => member.jointTypeId === jointTypeId),
    [members, jointTypeId],
  )

  const validation = useMemo(
    () => validateAssemblyPlan(steps, jointMembers, exceptions),
    [steps, jointMembers, exceptions],
  )

  const validationByStep = useMemo(() => {
    const map = new Map(validation.steps.map((item) => [item.stepId, item]))
    return map
  }, [validation])

  const totalDurationSec = useMemo(
    () => steps.reduce((total, step) => total + step.holdSec, 0),
    [steps],
  )

  const move = useCallback(async (from: number, to: number) => {
    const ok = await moveStep(jointTypeId, from, to, jointMembers, exceptions)
    // 提交事务可能已清除失效例外，刷新内存状态与数据库保持一致
    if (ok) await loadExceptions(jointTypeId)
    return ok
  }, [jointTypeId, jointMembers, exceptions, moveStep, loadExceptions])

  const updateStep = useCallback(async (stepId: string, patch: StepPatch) => {
    const ok = await saveStep(jointTypeId, stepId, patch, jointMembers, exceptions)
    if (ok) await loadExceptions(jointTypeId)
    return ok
  }, [jointTypeId, jointMembers, exceptions, saveStep, loadExceptions])

  const grantForStep = useCallback(async (stepId: string, code: ValidationCode, reason: string) => {
    const step = steps.find((item) => item.id === stepId)
    const item = validationByStep.get(stepId)
    // 只能对当前确实存在的硬性阻挡授予例外，且依据指纹取当前内容
    if (!step || !item) return
    const stillBlocked = item.blocking.some((issue) => issue.code === code && !item.activeExceptions[code])
    if (!stillBlocked) return
    await grantException({
      jointTypeId,
      stepId,
      code,
      reason: reason.trim() || '老师现场确认放行',
      basisFingerprint: stepBasisFingerprint(step),
    })
  }, [steps, validationByStep, grantException, jointTypeId])

  const revokeForStep = useCallback(async (exceptionId: string) => {
    await revokeException(exceptionId)
  }, [revokeException])

  const memberById = useCallback((id: string): Member | undefined =>
    jointMembers.find((member) => member.id === id), [jointMembers])

  const stepById = useCallback((id: string): DisassemblyStep | undefined =>
    steps.find((step) => step.id === id), [steps])

  return {
    steps,
    members: jointMembers,
    exceptions,
    validation,
    validationByStep,
    totalDurationSec,
    currentStepIndex: Math.min(currentStepIndex, Math.max(0, steps.length - 1)),
    rejection,
    move,
    updateStep,
    setCurrentStep,
    dismissRejection,
    grantForStep,
    revokeForStep,
    memberById,
    stepById,
  }
}
