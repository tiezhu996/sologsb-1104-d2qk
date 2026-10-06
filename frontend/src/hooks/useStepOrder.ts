import { useCallback, useEffect, useMemo } from 'react'
import { useJointStore } from '../stores/jointStore'
import { useStepStore, type StepRelationsPatch } from '../stores/stepStore'
import type { DisassemblyStep } from '../types/step'
import type { Member } from '../types/member'
import { buildAssemblyPlan, type AssemblyPlan, type PlanStep } from '../utils/assemblyPlan'

interface StepOrderResult {
  steps: DisassemblyStep[]
  /** 带构件、前置、阻挡原因与可执行性的装配计划 */
  plan: AssemblyPlan
  planSteps: PlanStep[]
  members: Member[]
  totalDurationSec: number
  currentStepIndex: number
  lastRejection: string | null
  move: (from: number, to: number) => Promise<boolean>
  updateRelations: (stepId: string, patch: StepRelationsPatch) => Promise<boolean>
  grantException: (stepId: string, reason: string) => Promise<boolean>
  clearException: (stepId: string) => Promise<void>
  dismissRejection: () => void
  setCurrentStep: (index: number) => void
}

export function useStepOrder(jointTypeId: string): StepOrderResult {
  const allSteps = useStepStore((state) => state.steps)
  const currentStepIndex = useStepStore((state) => state.currentStepIndex)
  const lastRejection = useStepStore((state) => state.lastRejection)
  const loadSteps = useStepStore((state) => state.loadSteps)
  const setCurrentStep = useStepStore((state) => state.setCurrentStep)
  const allMembers = useJointStore((state) => state.members)

  useEffect(() => {
    if (!jointTypeId) return
    void loadSteps(jointTypeId)
  }, [jointTypeId, loadSteps])

  const steps = useMemo(
    () => allSteps
      .filter((step) => step.jointTypeId === jointTypeId)
      .sort((a, b) => a.seq - b.seq),
    [allSteps, jointTypeId],
  )

  const members = useMemo(
    () => allMembers.filter((member) => member.jointTypeId === jointTypeId),
    [allMembers, jointTypeId],
  )

  // 页面与导出共用同一套校验规则
  const plan = useMemo(() => buildAssemblyPlan(steps, members), [steps, members])

  const totalDurationSec = useMemo(
    () => steps.reduce((total, step) => total + step.holdSec, 0),
    [steps],
  )

  const move = useCallback(async (from: number, to: number) => (
    useStepStore.getState().moveStep(from, to)
  ), [])
  const updateRelations = useCallback(
    async (stepId: string, patch: StepRelationsPatch) => (
      useStepStore.getState().updateStepRelations(stepId, patch)
    ),
    [],
  )
  const grantException = useCallback(
    async (stepId: string, reason: string) => (
      useStepStore.getState().grantException(stepId, reason)
    ),
    [],
  )
  const clearException = useCallback(
    async (stepId: string) => useStepStore.getState().clearException(stepId),
    [],
  )
  const dismissRejection = useCallback(() => useStepStore.getState().dismissRejection(), [])

  return {
    steps,
    plan,
    planSteps: plan.steps,
    members,
    totalDurationSec,
    currentStepIndex: Math.min(currentStepIndex, Math.max(0, steps.length - 1)),
    lastRejection,
    move,
    updateRelations,
    grantException,
    clearException,
    dismissRejection,
    setCurrentStep,
  }
}
