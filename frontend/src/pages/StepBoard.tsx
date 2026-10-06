import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { ExceptionPanel } from '../components/common/ExceptionPanel'
import { StepPlanEditor } from '../components/common/StepPlanEditor'
import { StepRail } from '../components/common/StepRail'
import { SvgCanvas } from '../components/common/SvgCanvas'
import { useAssemblyPlan } from '../hooks/useAssemblyPlan'
import { useDiagramStore } from '../stores/diagramStore'
import { useJointStore } from '../stores/jointStore'
import { exportAssemblyPlan } from '../utils/export'
import type { StepValidation } from '../utils/assemblyPlan'

export default function StepBoard() {
  const { id: idParam } = useParams()
  const id = idParam ?? ''
  const joints = useJointStore((state) => state.joints)
  const loadAll = useJointStore((state) => state.loadAll)
  const diagrams = useDiagramStore((state) => state.diagrams)
  const selectedMemberId = useDiagramStore((state) => state.selectedMemberId)
  const loadDiagrams = useDiagramStore((state) => state.loadDiagrams)
  const setSelectedMember = useDiagramStore((state) => state.setSelectedMember)

  const {
    steps,
    members,
    validation,
    validationByStep,
    totalDurationSec,
    currentStepIndex,
    rejection,
    move,
    updateStep,
    setCurrentStep,
    dismissRejection,
    grantForStep,
    revokeForStep,
    memberById,
    stepById,
  } = useAssemblyPlan(id)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadAll()
    if (id) void loadDiagrams(id)
  }, [id, loadAll, loadDiagrams])

  const joint = joints.find((item) => item.id === id)
  const currentStep = steps[currentStepIndex]
  const currentValidation = currentStep ? validationByStep.get(currentStep.id) : undefined
  const currentDiagram = diagrams.find((diagram) => diagram.stepId === currentStep?.id) ?? diagrams[0]

  const handleSave = async (patch: Parameters<typeof updateStep>[1]): Promise<boolean> => {
    if (!currentStep) return false
    setSaving(true)
    try {
      return await updateStep(currentStep.id, patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`/joints/${id}`} className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
          <span aria-hidden="true">←</span> 返回类型详情
        </Link>
        <button
          type="button"
          className="secondary-button"
          disabled={steps.length === 0}
          onClick={() => void exportAssemblyPlan(id, joint?.name ?? '榫卯')}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
          导出装配计划
        </button>
      </div>

      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">ASSEMBLY PLAN</p>
          <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">{joint?.name ?? '榫卯'} · 装配计划编排</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            每一步都关联构件与前置，带施力方向和工具；拖动调序或编辑保存都会重新校验，
            前置成环、方向互锁、同抢工具的步骤不能标为可执行。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <PlanStat label="步骤" value={steps.length} tone="text-wood-700" />
          <PlanStat label="可执行" value={validation.executableCount} tone="text-emerald-700" />
          <PlanStat label="不可执行" value={validation.blockedCount} tone="text-rose-700" />
          <PlanStat label="待补关系" value={validation.pendingCount} tone="text-amber-700" />
        </div>
      </section>

      {rejection ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4" data-testid="rollback-banner" role="alert">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-rose-900">
                {rejection.kind === 'move' ? '调序未通过校验，顺序已回到改动前' : '修改未通过校验，步骤内容与例外状态已回到改动前'}
                {rejection.stepLabels.length > 0 ? `（涉及第 ${[...new Set(rejection.stepLabels)].sort((a, b) => a - b).join('、')} 步）` : ''}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-6 text-rose-800">
                {rejection.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
              </ul>
            </div>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-100"
              onClick={() => dismissRejection()}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}

      {validation.hasStaleExceptions ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" role="status">
          <p className="text-sm font-semibold text-amber-900">存在已失效的老师例外</p>
          <p className="mt-1 text-xs leading-6 text-amber-800">
            例外所依据的关联内容已被修改，旧依据自动失效；请在对应步骤重新核实，或撤销后重登。
          </p>
        </div>
      ) : null}

      {steps.length === 0 ? (
        <BlankPanel title="当前类型尚无步骤" description="没有可编排的拆装动作，请先补充步骤数据。" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="panel max-h-[760px] overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-wood-900">步骤轨道</h2>
                <p className="mt-1 text-xs text-stone-500">拖动步骤后自动校验并保存，被阻挡则回原位</p>
              </div>
              <span className="rounded-full bg-wood-50 px-3 py-1 text-xs text-wood-700">共 {totalDurationSec} 秒</span>
            </div>
            <StepRail
              steps={steps}
              currentIndex={currentStepIndex}
              onSelect={setCurrentStep}
              onMove={(from, to) => void move(from, to)}
              validations={validationByStep}
              memberById={memberById}
              stepById={stepById}
            />
          </section>

          <section className="space-y-5">
            {currentStep ? (
              <div className="panel p-5">
                <div className="flex flex-wrap items-center gap-3 border-b border-wood-100 pb-4">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white ${
                    currentValidation?.blocking.some((issue) => !currentValidation.activeExceptions[issue.code])
                      ? 'bg-rose-600'
                      : currentValidation?.pending.length || currentValidation?.staleExceptions.length
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}>
                    {currentStep.seq}
                  </span>
                  <div className="mr-auto">
                    <h2 className="text-xl font-semibold text-wood-900">{currentStep.action} · {currentStep.direction}</h2>
                    <p className="mt-1 text-xs text-stone-500">使用工具：{currentStep.tool} · 停留 {currentStep.holdSec} 秒</p>
                  </div>
                  <StepStatusPill validation={currentValidation} />
                </div>

                <div className="mt-5">
                  <StepPlanEditor
                    key={currentStep.id}
                    step={currentStep}
                    members={members}
                    steps={steps}
                    validation={currentValidation}
                    saving={saving}
                    onSave={handleSave}
                  />
                </div>

                <div className="mt-5 border-t border-stone-100 pt-4">
                  <ExceptionPanel
                    stepSeq={currentStep.seq}
                    validation={currentValidation ?? {
                      stepId: currentStep.id, issues: [], blocking: [], pending: [],
                      activeExceptions: {}, staleExceptions: [], executable: true, complete: true,
                    }}
                    onGrant={(code, reason) => grantForStep(currentStep.id, code, reason)}
                    onRevoke={revokeForStep}
                  />
                </div>

                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-900">易损部位提醒</p>
                  <p className="mt-1 text-sm leading-6 text-amber-900/80">{currentStep.riskNote || '暂无提醒'}</p>
                </div>
              </div>
            ) : null}

            <SvgCanvas
              svgMarkup={currentDiagram?.svgMarkup ?? ''}
              title={currentDiagram?.title ?? '步骤预览'}
              hitAreas={currentDiagram?.hitAreas ?? []}
              selectedMemberId={selectedMemberId}
              onSelectMember={setSelectedMember}
              emptyMessage="该步骤暂未绑定示意图"
            />
          </section>
        </div>
      )}
    </div>
  )
}

function PlanStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-wood-100 bg-white px-3 py-2 text-center shadow-sm">
      <strong className={`block text-lg leading-6 ${tone}`}>{value}</strong>
      <span className="text-[11px] text-stone-500">{label}</span>
    </div>
  )
}

function StepStatusPill({ validation }: { validation: StepValidation | undefined }) {
  if (!validation) return null
  const unresolved = validation.blocking.some((issue) => !validation.activeExceptions[issue.code])
  if (unresolved) {
    return <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800">不可执行</span>
  }
  if (validation.staleExceptions.length > 0) {
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">例外失效待复核</span>
  }
  if (validation.pending.length > 0) {
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">可执行 · 有待补关系</span>
  }
  if (Object.keys(validation.activeExceptions).length > 0) {
    return <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">可执行 · 例外放行</span>
  }
  return <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">可执行</span>
}
