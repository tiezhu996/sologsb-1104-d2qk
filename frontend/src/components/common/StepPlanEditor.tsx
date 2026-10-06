import { useEffect, useState } from 'react'
import type { Member } from '../../types/member'
import type { DisassemblyStep, StepAction, StepDirection, StepTool } from '../../types/step'
import type { StepPatch } from '../../stores/stepStore'
import type { StepValidation } from '../../utils/assemblyPlan'

const ACTIONS: StepAction[] = ['拆卸', '装配']
const DIRECTIONS: StepDirection[] = ['轴向', '侧向', '斜向']
const TOOLS: StepTool[] = ['木槌', '鱼线', '撬板']

interface StepPlanEditorProps {
  step: DisassemblyStep
  members: Member[]
  steps: DisassemblyStep[]
  validation: StepValidation | undefined
  saving: boolean
  onSave: (patch: StepPatch) => Promise<boolean>
}

export function StepPlanEditor({ step, members, steps, validation, saving, onSave }: StepPlanEditorProps) {
  const [action, setAction] = useState<StepAction>(step.action)
  const [direction, setDirection] = useState<StepDirection>(step.direction)
  const [tool, setTool] = useState<StepTool>(step.tool)
  const [holdSec, setHoldSec] = useState<number>(step.holdSec)
  const [riskNote, setRiskNote] = useState<string>(step.riskNote)
  const [memberIds, setMemberIds] = useState<string[]>(step.memberIds)
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>(step.prerequisiteIds)

  // 切换到不同步骤后，表单回到该步骤已保存的内容（保存失败的回滚也会反映在这里）
  useEffect(() => {
    setAction(step.action)
    setDirection(step.direction)
    setTool(step.tool)
    setHoldSec(step.holdSec)
    setRiskNote(step.riskNote)
    setMemberIds(step.memberIds)
    setPrerequisiteIds(step.prerequisiteIds)
  }, [step.id, step.action, step.direction, step.tool, step.holdSec, step.riskNote, step.memberIds, step.prerequisiteIds])

  const toggle = (list: string[], id: string, apply: (next: string[]) => void) => {
    apply(list.includes(id) ? list.filter((item) => item !== id) : [...list, id])
  }

  const submit = async () => {
    await onSave({
      action,
      direction,
      tool,
      holdSec: Number.isFinite(holdSec) && holdSec > 0 ? Math.round(holdSec) : 0,
      riskNote: riskNote.trim() || step.riskNote,
      memberIds,
      prerequisiteIds,
    })
  }

  const unresolvedBlocking = validation?.blocking.filter((issue) => !validation.activeExceptions[issue.code]) ?? []
  const pending = validation?.pending ?? []

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">动作类型</span>
          <select className="input-field" value={action} onChange={(event) => setAction(event.target.value as StepAction)}>
            {ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">施力方向</span>
          <select className="input-field" value={direction} onChange={(event) => setDirection(event.target.value as StepDirection)}>
            {DIRECTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">使用工具</span>
          <select className="input-field" value={tool} onChange={(event) => setTool(event.target.value as StepTool)}>
            {TOOLS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-stone-700">关联构件（本步施力对象，可多选）</p>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            该类型尚无构件记录，请先在类型详情中补充构件。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const active = memberIds.includes(member.id)
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(memberIds, member.id, setMemberIds)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    active
                      ? 'border-wood-700 bg-wood-700 text-white'
                      : 'border-wood-100 bg-white text-wood-700 hover:border-wood-500'
                  }`}
                >
                  {member.name} · {member.part}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-stone-700">前置步骤（本步必须排在这些步骤之后）</p>
        <div className="flex flex-wrap gap-2">
          {steps.filter((item) => item.id !== step.id).map((candidate) => {
            const active = prerequisiteIds.includes(candidate.id)
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(prerequisiteIds, candidate.id, setPrerequisiteIds)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  active
                    ? 'border-wood-700 bg-wood-700 text-white'
                    : 'border-wood-100 bg-white text-wood-700 hover:border-wood-500'
                }`}
              >
                #{candidate.seq} {candidate.action} · {candidate.direction}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">停留秒数</span>
          <input
            type="number"
            min={0}
            className="input-field"
            value={holdSec}
            onChange={(event) => setHoldSec(Number(event.target.value))}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-stone-700">易损部位提醒</span>
          <input className="input-field" value={riskNote} onChange={(event) => setRiskNote(event.target.value)} />
        </label>
      </div>

      {unresolvedBlocking.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs leading-6 text-rose-800" data-testid="editor-block-reason">
          {unresolvedBlocking.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : null}
      {pending.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-6 text-amber-800">
          {pending.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : null}

      <div className="flex justify-end">
        <button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>
          {saving ? '校验保存中…' : '校验并保存本步'}
        </button>
      </div>
    </div>
  )
}
