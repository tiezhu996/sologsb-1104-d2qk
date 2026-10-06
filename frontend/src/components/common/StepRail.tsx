import type { DragEvent } from 'react'
import type { Member } from '../../types/member'
import type { DisassemblyStep } from '../../types/step'
import type { StepValidation } from '../../utils/assemblyPlan'
import { VALIDATION_CODE_LABEL } from '../../types/exception'

interface StepRailProps {
  steps: DisassemblyStep[]
  currentIndex: number
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  validations?: Map<string, StepValidation>
  memberById?: (id: string) => Member | undefined
  stepById?: (id: string) => DisassemblyStep | undefined
}

function rowTone(validation: StepValidation | undefined): {
  badge: string
  border: string
  label: string
} {
  if (!validation) {
    return { badge: 'bg-stone-100 text-stone-600', border: 'border-stone-200 bg-white', label: '未校验' }
  }
  const unresolved = validation.blocking.some((issue) => !validation.activeExceptions[issue.code])
  if (unresolved) return { badge: 'bg-rose-600 text-white', border: 'border-rose-300 bg-rose-50/50', label: '不可执行' }
  if (validation.staleExceptions.length > 0) {
    return { badge: 'bg-amber-500 text-white', border: 'border-amber-300 bg-amber-50/60', label: '例外失效' }
  }
  if (validation.pending.length > 0) return { badge: 'bg-amber-500 text-white', border: 'border-amber-200 bg-white', label: '待补关系' }
  if (Object.keys(validation.activeExceptions).length > 0) {
    return { badge: 'bg-sky-600 text-white', border: 'border-sky-200 bg-sky-50/50', label: '例外放行' }
  }
  return { badge: 'bg-emerald-600 text-white', border: 'border-emerald-200 bg-white', label: '可执行' }
}

export function StepRail({
  steps,
  currentIndex,
  onSelect,
  onMove,
  validations,
  memberById,
  stepById,
}: StepRailProps) {
  const handleDrop = (event: DragEvent<HTMLElement>, to: number) => {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isInteger(from)) onMove(from, to)
  }

  return (
    <div className="space-y-3" aria-label="拆装步骤轨道">
      {steps.map((step, index) => {
        const validation = validations?.get(step.id)
        const tone = rowTone(validation)
        const unresolvedBlocking = validation?.blocking.filter((issue) => !validation.activeExceptions[issue.code]) ?? []
        const waivedBlocking = validation?.blocking.filter((issue) => validation.activeExceptions[issue.code]) ?? []
        const prereqSeqs = step.prerequisiteIds
          .map((id) => stepById?.(id)?.seq)
          .filter((seq): seq is number => typeof seq === 'number')
        const linkedMembers = step.memberIds
          .map((id) => memberById?.(id))
          .filter((member): member is Member => Boolean(member))
        const missingMembers = step.memberIds.filter((id) => memberById && !memberById(id))

        return (
          <article
            key={step.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => handleDrop(event, index)}
            className={`group rounded-xl border p-3 transition ${
              currentIndex === index ? 'border-wood-500 bg-wood-50 shadow-sm' : `${tone.border} hover:border-wood-100`
            }`}
            data-testid="step-row"
            data-executable={validation ? validation.executable : undefined}
          >
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                currentIndex === index ? 'bg-wood-700 text-white' : tone.badge
              }`}>
                {step.seq}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-stone-900">{step.action}</strong>
                  <span className="text-xs text-stone-500">{step.direction} · {step.tool}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    currentIndex === index ? 'bg-wood-100 text-wood-800' : tone.badge
                  }`}>{tone.label}</span>
                </span>

                <span className="mt-1.5 flex flex-wrap gap-1">
                  {linkedMembers.map((member) => (
                    <span key={member.id} className="rounded bg-wood-50 px-1.5 py-0.5 text-[10px] text-wood-700 ring-1 ring-wood-100">
                      {member.name}
                    </span>
                  ))}
                  {missingMembers.map((id) => (
                    <span key={id} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-200">
                      构件已缺失
                    </span>
                  ))}
                  {step.memberIds.length === 0 ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 ring-1 ring-amber-200">未关联构件</span>
                  ) : null}
                  {prereqSeqs.length > 0 ? (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                      前置 {prereqSeqs.sort((a, b) => a - b).map((seq) => `#${seq}`).join(' ')}
                    </span>
                  ) : (
                    <span className="rounded bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 ring-1 ring-stone-200">无前置</span>
                  )}
                  {step.prerequisiteIds.some((id) => !stepById?.(id)) ? (
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-200">前置已缺失</span>
                  ) : null}
                </span>

                <span className="mt-1 block text-xs leading-5 text-stone-500">{step.riskNote}</span>
                <span className="mt-0.5 block text-[11px] text-wood-700">停留 {step.holdSec} 秒</span>
              </span>
            </button>

            {unresolvedBlocking.length > 0 ? (
              <ul className="mt-2 space-y-1 rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] leading-5 text-rose-800" data-testid="block-reason">
                {unresolvedBlocking.map((issue) => (
                  <li key={issue.code} className="flex gap-1.5">
                    <span className="shrink-0 font-semibold">{VALIDATION_CODE_LABEL[issue.code]}</span>
                    <span>{issue.message.replace(/^[^：]+：/, '')}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {waivedBlocking.length > 0 ? (
              <ul className="mt-2 space-y-1 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-800">
                {waivedBlocking.map((issue) => (
                  <li key={issue.code}>老师例外已放行「{VALIDATION_CODE_LABEL[issue.code]}」</li>
                ))}
              </ul>
            ) : null}

            {validation?.staleExceptions.length ? (
              <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
                {validation.staleExceptions.map((exception) => (
                  <li key={exception.id}>
                    老师对「{VALIDATION_CODE_LABEL[exception.code]}」的例外依据已随关联内容修改失效，需重新确认。
                  </li>
                ))}
              </ul>
            ) : null}

            {validation && unresolvedBlocking.length === 0 && validation.pending.length > 0 ? (
              <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-800">
                {validation.pending.map((issue) => (
                  <li key={issue.code}>{issue.message}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-2 flex justify-end">
              <span className="cursor-grab select-none rounded px-2 py-1 text-[11px] text-stone-400 group-active:cursor-grabbing">
                拖动调序
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
