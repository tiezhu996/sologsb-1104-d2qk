import { useState } from 'react'
import { VALIDATION_CODE_LABEL, type ValidationCode } from '../../types/exception'
import type { StepValidation } from '../../utils/assemblyPlan'

interface ExceptionPanelProps {
  stepSeq: number
  validation: StepValidation
  onGrant: (code: ValidationCode, reason: string) => Promise<void>
  onRevoke: (exceptionId: string) => Promise<void>
}

/** 老师对硬性阻挡留下例外依据；关联内容修改后依据指纹不符会自动失效 */
export function ExceptionPanel({ stepSeq, validation, onGrant, onRevoke }: ExceptionPanelProps) {
  const [reasonByCode, setReasonByCode] = useState<Partial<Record<ValidationCode, string>>>({})
  const [busy, setBusy] = useState(false)

  const allExceptions = [
    ...Object.values(validation.activeExceptions),
    ...validation.staleExceptions,
  ]

  const grant = async (code: ValidationCode) => {
    setBusy(true)
    try {
      await onGrant(code, reasonByCode[code] ?? '')
      setReasonByCode((current) => ({ ...current, [code]: '' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-stone-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-800">老师例外依据</h3>
        <span className="text-[11px] text-stone-500">仅可放行硬性阻挡；关联内容一改，旧依据立即失效</span>
      </div>

      {allExceptions.length === 0 ? (
        <p className="mt-3 text-xs leading-6 text-stone-500">
          第 {stepSeq} 步暂无老师例外。出现前置成环、方向互锁或工具冲突时，可由老师写明现场依据后放行。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {allExceptions.map((exception) => {
            const stale = validation.staleExceptions.includes(exception)
            return (
              <li key={exception.id} className={`rounded-lg border px-3 py-2 text-xs ${
                stale ? 'border-amber-300 bg-amber-50' : 'border-sky-200 bg-sky-50'
              }`}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className={stale ? 'text-amber-900' : 'text-sky-900'}>
                    {VALIDATION_CODE_LABEL[exception.code]}
                  </strong>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                    stale ? 'bg-amber-200 text-amber-900' : 'bg-sky-200 text-sky-900'
                  }`}>
                    {stale ? '依据已失效' : '放行中'}
                  </span>
                  <button
                    type="button"
                    className="ml-auto rounded px-2 py-1 text-[11px] text-stone-500 underline-offset-2 hover:underline"
                    disabled={busy}
                    onClick={() => void onRevoke(exception.id)}
                  >
                    撤销例外
                  </button>
                </div>
                <p className="mt-1 leading-5 text-stone-700">{exception.reason}</p>
                <p className="mt-1 text-[10px] text-stone-400">授予时间 {new Date(exception.grantedAt).toLocaleString('zh-CN')}</p>
              </li>
            )
          })}
        </ul>
      )}

      {validation.blocking.some((issue) => !validation.activeExceptions[issue.code]) ? (
        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          {validation.blocking
            .filter((issue) => !validation.activeExceptions[issue.code])
            .map((issue) => (
              <div key={issue.code} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input-field flex-1 text-xs"
                  placeholder={`为「${VALIDATION_CODE_LABEL[issue.code]}」写明老师放行依据`}
                  value={reasonByCode[issue.code] ?? ''}
                  onChange={(event) => setReasonByCode((current) => ({ ...current, [issue.code]: event.target.value }))}
                />
                <button
                  type="button"
                  className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void grant(issue.code)}
                >
                  登记例外放行
                </button>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  )
}
