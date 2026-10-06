import type { DragEvent, ReactNode } from 'react'
import type { PlanStep } from '../../utils/assemblyPlan'

interface StepRailProps {
  planSteps: PlanStep[]
  currentIndex: number
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
}

export function StepRail({ planSteps, currentIndex, onSelect, onMove }: StepRailProps) {
  const handleDrop = (event: DragEvent<HTMLElement>, to: number) => {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isInteger(from)) onMove(from, to)
  }

  return (
    <div className="space-y-3" aria-label="拆装步骤轨道">
      {planSteps.map((item, index) => {
        const { step, member, blockers, executable, exceptionActive, exceptionStale } = item
        const activeBlockers = blockers.filter((blocker) => !(exceptionActive && blocker.exemptable))
        const isCurrent = currentIndex === index
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
              isCurrent
                ? 'border-wood-500 bg-wood-50 shadow-sm'
                : executable
                  ? 'border-stone-200 bg-white hover:border-emerald-300'
                  : 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
            }`}
            data-testid="step-row"
            data-executable={executable ? 'true' : 'false'}
          >
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                isCurrent
                  ? 'bg-wood-700 text-white'
                  : executable
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
              }`}>
                {step.seq}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-stone-900">{step.action}</strong>
                  <span className="text-xs text-stone-500">{step.direction} · {step.tool}</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      executable ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                    data-testid="step-status"
                  >
                    {executable ? '可执行' : '不可执行'}
                  </span>
                </span>

                <span className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  <Tag className="bg-stone-100 text-stone-600">
                    构件：{member ? `${member.name}` : '未绑定'}
                  </Tag>
                  {step.isStart
                    ? <Tag className="bg-sky-50 text-sky-800">起始步</Tag>
                    : item.prereqs.length > 0
                      ? <Tag className="bg-stone-100 text-stone-600">
                          前置：{item.prereqs.map((prereq) => `第${prereq.seq}步`).join('、')}
                        </Tag>
                      : <Tag className="bg-amber-100 text-amber-900">前置：待补</Tag>}
                </span>

                {activeBlockers.length > 0 && (
                  <span className="mt-2 block space-y-1">
                    {activeBlockers.map((blocker) => (
                      <span key={`${blocker.code}-${blocker.message}`} className="block rounded-lg bg-rose-100/70 px-2 py-1 text-[11px] leading-5 text-rose-900" data-testid="step-blocker">
                        阻挡：{blocker.message}
                      </span>
                    ))}
                  </span>
                )}

                {step.exception && (
                  <span className={`mt-2 block rounded-lg px-2 py-1 text-[11px] leading-5 ${
                    exceptionStale ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100/80 text-emerald-900'
                  }`} data-testid="step-exception">
                    {exceptionStale
                      ? `例外已失效（关联内容已修改）：${step.exception.reason}`
                      : `老师例外放行：${step.exception.reason}`}
                  </span>
                )}

                <span className="mt-1 block text-xs leading-5 text-stone-500">{step.riskNote}</span>
                <span className="mt-0.5 block text-[11px] text-wood-700">停留 {step.holdSec} 秒</span>
              </span>
            </button>
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

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${className}`}>{children}</span>
  )
}
