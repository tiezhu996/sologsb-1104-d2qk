import { useEffect, useState } from 'react'
import type { Member } from '../../types/member'
import type { PlanStep } from '../../utils/assemblyPlan'
import { STEP_ACTIONS, STEP_DIRECTIONS, STEP_TOOLS } from '../../types/step'

interface StepRelationEditorProps {
  planStep: PlanStep
  allPlanSteps: PlanStep[]
  members: Member[]
  saving: boolean
  onSave: (patch: {
    memberId: string | null
    prereqIds: string[]
    isStart: boolean
    direction: PlanStep['step']['direction']
    tool: PlanStep['step']['tool']
  }) => Promise<void>
  onGrantException: (reason: string) => Promise<void>
  onClearException: () => Promise<void>
}

export function StepRelationEditor({
  planStep,
  allPlanSteps,
  members,
  saving,
  onSave,
  onGrantException,
  onClearException,
}: StepRelationEditorProps) {
  const { step } = planStep
  const [memberId, setMemberId] = useState(step.memberId ?? '')
  const [prereqIds, setPrereqIds] = useState<string[]>(step.prereqIds ?? [])
  const [isStart, setIsStart] = useState(Boolean(step.isStart))
  const [direction, setDirection] = useState(step.direction)
  const [tool, setTool] = useState(step.tool)
  const [exceptionReason, setExceptionReason] = useState('')
  const [exceptionSaving, setExceptionSaving] = useState(false)

  // 切换到不同步骤时重置表单为该步骤当前值
  useEffect(() => {
    setMemberId(step.memberId ?? '')
    setPrereqIds(step.prereqIds ?? [])
    setIsStart(Boolean(step.isStart))
    setDirection(step.direction)
    setTool(step.tool)
    setExceptionReason('')
  }, [step.id, step.memberId, step.prereqIds, step.isStart, step.direction, step.tool])

  const togglePrereq = (id: string) => {
    setIsStart(false)
    setPrereqIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  const canGrantException = planStep.blockers.some((blocker) => blocker.exemptable)
    && !planStep.blockers.some((blocker) => !blocker.exemptable)

  return (
    <div className="space-y-4" data-testid="relation-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">关联构件</span>
          <select
            className="input-field"
            data-testid="field-member"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            <option value="">未绑定（待补构件）</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} · {member.part}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">动作</span>
          <div className="flex gap-1.5">
            {STEP_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                disabled
                className="flex-1 rounded-lg border border-stone-200 px-2 py-2 text-xs text-stone-500"
                title="动作类型由原始记录决定"
              >
                {action === step.action ? `✓ ${action}` : action}
              </button>
            ))}
          </div>
        </div>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">构件方向</span>
          <select
            className="input-field"
            data-testid="field-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as typeof direction)}
          >
            {STEP_DIRECTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">使用工具</span>
          <select
            className="input-field"
            data-testid="field-tool"
            value={tool}
            onChange={(event) => setTool(event.target.value as typeof tool)}
          >
            {STEP_TOOLS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-stone-700">前置关系</legend>
        <label className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
          <input
            type="checkbox"
            data-testid="field-start"
            checked={isStart}
            onChange={(event) => {
              setIsStart(event.target.checked)
              if (event.target.checked) setPrereqIds([])
            }}
          />
          起始步（无需前置，可直接执行）
        </label>
        <div className="grid gap-1.5">
          {allPlanSteps
            .filter((item) => item.step.id !== step.id)
            .map((item) => {
              const checked = prereqIds.includes(item.step.id)
              const later = item.step.seq > step.seq
              return (
                <label
                  key={item.step.id}
                  className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700"
                >
                  <input
                    type="checkbox"
                    data-testid="field-prereq"
                    checked={checked}
                    onChange={() => togglePrereq(item.step.id)}
                  />
                  <span className="font-medium">第{item.step.seq}步</span>
                  <span className="text-stone-500">{item.step.action} · {item.step.direction}</span>
                  {later && checked && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900">
                      该前置排在后面（前置倒置）
                    </span>
                  )}
                </label>
              )
            })}
        </div>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="button"
          className="primary-button"
          data-testid="save-relations"
          disabled={saving}
          onClick={() => void onSave({
            memberId: memberId || null,
            prereqIds,
            isStart,
            direction,
            tool,
          })}
        >
          {saving ? '校验并保存中…' : '保存关联并校验'}
        </button>
      </div>

      <section className="rounded-xl border border-wood-100 bg-wood-50/50 p-3" data-testid="exception-panel">
        <p className="text-xs font-semibold text-wood-900">老师例外</p>
        <p className="mt-1 text-[11px] leading-5 text-stone-500">
          例外只能豁免前置倒置、方向互锁、工具同抢；缺构件、缺前置、悬空前置、成环不可放行。
          关联内容一经修改，例外依据立即失效。
        </p>

        {step.exception && (
          <div className={`mt-2 rounded-lg px-3 py-2 text-xs leading-5 ${
            planStep.exceptionStale ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100/80 text-emerald-900'
          }`}>
            <p>
              {planStep.exceptionStale ? '已失效：关联内容修改后签名不匹配。' : '生效中'}
              依据：{step.exception.reason}
            </p>
            <p className="mt-0.5 text-[10px] opacity-70">
              授予时间 {new Date(step.exception.grantedAt).toLocaleString('zh-CN')}
            </p>
            <button
              type="button"
              className="mt-1.5 rounded border border-stone-400/50 px-2 py-0.5 text-[11px]"
              onClick={() => void onClearException()}
            >
              撤销例外
            </button>
          </div>
        )}

        {canGrantException && !planStep.exceptionActive && (
          <div className="mt-2 space-y-2">
            <textarea
              rows={2}
              className="input-field resize-y text-xs"
              data-testid="field-exception-reason"
              placeholder="写明例外依据，例如：老师确认该方向互锁在本家具上可先松后紧。"
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
            />
            <button
              type="button"
              className="secondary-button text-xs"
              data-testid="grant-exception"
              disabled={exceptionSaving || !exceptionReason.trim()}
              onClick={async () => {
                setExceptionSaving(true)
                try {
                  await onGrantException(exceptionReason)
                  setExceptionReason('')
                } finally {
                  setExceptionSaving(false)
                }
              }}
            >
              留下例外依据并放行
            </button>
          </div>
        )}
        {!canGrantException && !step.exception && (
          <p className="mt-2 text-[11px] text-stone-400">
            当前没有可豁免的冲突类阻挡（结构类阻挡不能放行）。
          </p>
        )}
      </section>
    </div>
  )
}
