import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { StepRail } from '../components/common/StepRail'
import { StepRelationEditor } from '../components/common/StepRelationEditor'
import { SvgCanvas } from '../components/common/SvgCanvas'
import { useStepOrder } from '../hooks/useStepOrder'
import { useDiagramStore } from '../stores/diagramStore'
import { useJointStore } from '../stores/jointStore'
import type { StepRelationsPatch } from '../stores/stepStore'
import type { PlanStep } from '../utils/assemblyPlan'
import { exportAssemblyPlan } from '../utils/export'

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
    plan,
    planSteps,
    members,
    totalDurationSec,
    currentStepIndex,
    lastRejection,
    move,
    updateRelations,
    grantException,
    clearException,
    dismissRejection,
    setCurrentStep,
  } = useStepOrder(id)
  const [savingRelations, setSavingRelations] = useState(false)
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void loadAll()
    if (id) void loadDiagrams(id)
  }, [id, loadAll, loadDiagrams])

  const joint = joints.find((item) => item.id === id)
  const currentPlanStep = planSteps[currentStepIndex]
  const currentStep = currentPlanStep?.step
  const currentDiagram = diagrams.find((diagram) => diagram.stepId === currentStep?.id) ?? diagrams[0]

  const pendingSteps = useMemo(
    () => plan.pendingRelationSteps,
    [plan.pendingRelationSteps],
  )

  const handleSaveRelations = async (patch: StepRelationsPatch & {
    memberId?: string | null
  }) => {
    if (!currentStep) return
    setSavingRelations(true)
    setSaveNotice(null)
    const ok = await updateRelations(currentStep.id, patch)
    setSaveNotice(ok
      ? { ok: true, text: '关联已保存并重新校验。' }
      : { ok: false, text: '校验失败，顺序与例外状态已回到改动前，详见上方提示。' })
    setSavingRelations(false)
  }

  return (
    <div className="space-y-7">
      <div>
        <Link to={`/joints/${id}`} className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
          <span aria-hidden="true">←</span> 返回类型详情
        </Link>
      </div>

      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">ASSEMBLY PLAN</p>
          <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">{joint?.name ?? '榫卯'} · 装配计划编排</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            每一步关联构件与前置，并带方向与工具。拖动调序后统一校验：前置成环、方向互锁或同抢工具的节点不会标为可执行，阻挡原因在页面和导出中都会写清。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-wood-100 bg-white px-5 py-3 text-sm text-stone-600 shadow-sm">
            {planSteps.length} 步 · 可执行 <strong className="text-emerald-700" data-testid="count-executable">{plan.executableCount}</strong>
            {' '}· 阻挡 <strong className="text-rose-700" data-testid="count-blocked">{plan.blockedCount}</strong>
            {' '}· 停留 {totalDurationSec} 秒
          </div>
          <button
            type="button"
            className="primary-button"
            data-testid="export-plan"
            onClick={() => void exportAssemblyPlan(id, joint?.name ?? '未命名类型')}
          >
            导出装配计划
          </button>
        </div>
      </section>

      {lastRejection && (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="rejection-banner" role="alert">
          <p className="leading-6">⚠️ {lastRejection}</p>
          <button type="button" className="shrink-0 text-xs underline" onClick={dismissRejection}>知道了</button>
        </div>
      )}

      {saveNotice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            saveNotice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
          data-testid="save-notice"
          role="status"
        >
          {saveNotice.text}
        </div>
      )}

      {pendingSteps.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4" data-testid="pending-relations">
          <h2 className="text-sm font-semibold text-amber-900">待补关系（{pendingSteps.length}）</h2>
          <p className="mt-1 text-xs leading-5 text-amber-900/80">
            下列步骤缺少前置或构件关联，旧步骤迁移后也会进入这里，补齐前不能执行：
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {pendingSteps.map((item) => (
              <li key={item.step.id}>
                <button
                  type="button"
                  className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
                  onClick={() => setCurrentStep(planSteps.findIndex((planItem) => planItem.step.id === item.step.id))}
                >
                  第{item.step.seq}步：
                  {[
                    item.blockers.some((blocker) => blocker.code === 'missing-prereq') ? '缺前置' : null,
                    item.blockers.some((blocker) => blocker.code === 'missing-member') ? '缺构件' : null,
                  ].filter(Boolean).join('、')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.cycleStepIds.size > 0 && (
        <section className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900" data-testid="cycle-banner" role="alert">
          检测到前置成环：环上 {plan.cycleStepIds.size} 个节点均不可执行，需先断开环路。
        </section>
      )}

      {planSteps.length === 0 ? (
        <BlankPanel title="当前类型尚无步骤" description="没有可编排的拆装动作，请先补充步骤数据。" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="panel max-h-[760px] overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-wood-900">步骤轨道</h2>
                <p className="mt-1 text-xs text-stone-500">拖动步骤调序，成环的拖动会被拒绝</p>
              </div>
              <span className="rounded-full bg-wood-50 px-3 py-1 text-xs text-wood-700">自动保存</span>
            </div>
            <StepRail
              planSteps={planSteps}
              currentIndex={currentStepIndex}
              onSelect={setCurrentStep}
              onMove={(from, to) => void move(from, to)}
            />
          </section>

          <section className="space-y-5">
            {currentPlanStep && (
              <div className="panel p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white ${
                    currentPlanStep.executable ? 'bg-emerald-600' : 'bg-rose-600'
                  }`}>
                    {currentStep?.seq ?? 0}
                  </span>
                  <div>
                    <h2 className="text-xl font-semibold text-wood-900">
                      {currentStep?.action} · {currentPlanStep.member?.name ?? '未绑定构件'}
                    </h2>
                    <p className="mt-1 text-xs text-stone-500">
                      方向：{currentStep?.direction} · 工具：{currentStep?.tool} · 停留 {currentStep?.holdSec ?? 0} 秒
                    </p>
                  </div>
                  <span
                    className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
                      currentPlanStep.executable ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                    data-testid="current-status"
                  >
                    {currentPlanStep.executable ? '✓ 可执行' : '✕ 不可执行'}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-stone-50 px-3 py-2">
                    <span className="text-stone-500">构件</span>
                    <p className="mt-0.5 font-medium text-stone-800">
                      {currentPlanStep.member
                        ? `${currentPlanStep.member.name}（${currentPlanStep.member.part}）`
                        : '未绑定'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-stone-50 px-3 py-2">
                    <span className="text-stone-500">前置</span>
                    <p className="mt-0.5 font-medium text-stone-800">
                      {currentStep?.isStart
                        ? '起始步（无前置）'
                        : currentPlanStep.prereqs.length > 0
                          ? currentPlanStep.prereqs.map((prereq) => `第${prereq.seq}步`).join('、')
                          : '待补'}
                    </p>
                  </div>
                </div>

                <BlockerList planStep={currentPlanStep} />
              </div>
            )}

            {currentPlanStep && (
              <div className="panel p-5">
                <h3 className="font-semibold text-wood-900">关联与校验</h3>
                <p className="mt-1 text-xs text-stone-500">
                  修改构件、前置、方向或工具后保存；关联内容变化会使老师例外失效。
                </p>
                <div className="mt-4">
                  <StepRelationEditor
                    planStep={currentPlanStep}
                    allPlanSteps={planSteps}
                    members={members}
                    saving={savingRelations}
                    onSave={handleSaveRelations}
                    onGrantException={async (reason) => {
                      if (currentStep) await grantException(currentStep.id, reason)
                    }}
                    onClearException={async () => {
                      if (currentStep) await clearException(currentStep.id)
                    }}
                  />
                </div>
              </div>
            )}

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

function BlockerList({ planStep }: { planStep: PlanStep }) {
  const active = planStep.blockers.filter((blocker) => !(planStep.exceptionActive && blocker.exemptable))
  if (active.length === 0 && planStep.exceptionActive) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3" data-testid="blocker-list">
        <p className="text-xs font-semibold text-emerald-900">例外放行中</p>
        <p className="mt-1 text-xs leading-5 text-emerald-900/80">
          冲突类阻挡已凭老师例外标为可执行；关联内容再被修改，例外立即失效。
        </p>
      </div>
    )
  }
  if (active.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3" data-testid="blocker-list">
        <p className="text-xs font-semibold text-emerald-900">校验通过</p>
        <p className="mt-1 text-xs leading-5 text-emerald-900/80">前置、方向与工具均无冲突，可以执行。</p>
      </div>
    )
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3" data-testid="blocker-list">
      <p className="text-xs font-semibold text-rose-900">阻挡原因（{active.length}）</p>
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-rose-900/90">
        {active.map((blocker) => (
          <li key={`${blocker.code}-${blocker.message}`}>
            {blocker.message}
            {blocker.exemptable && <span className="ml-1 text-[10px] text-rose-500">（可凭老师例外放行）</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
