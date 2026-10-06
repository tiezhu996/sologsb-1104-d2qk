import { create } from 'zustand'
import { db } from '../utils/db'
import type { StepException, ValidationCode } from '../types/exception'

export type { StepException, ValidationCode }

interface ExceptionState {
  exceptions: StepException[]
  loading: boolean
  loadExceptions: (jointTypeId?: string) => Promise<void>
  grantException: (draft: Omit<StepException, 'id' | 'grantedAt' | 'schemaRev'>) => Promise<StepException>
  revokeException: (id: string) => Promise<void>
  clearJointExceptions: (jointTypeId: string) => Promise<void>
}

function createId(): string {
  return `exc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useExceptionStore = create<ExceptionState>((set, get) => ({
  exceptions: [],
  loading: false,

  loadExceptions: async (jointTypeId) => {
    set({ loading: true })
    try {
      const exceptions = jointTypeId
        ? await db.stepExceptions.where('jointTypeId').equals(jointTypeId).toArray()
        : await db.stepExceptions.toArray()
      set({ exceptions })
    } finally {
      set({ loading: false })
    }
  },

  grantException: async (draft) => {
    const exception: StepException = { ...draft, id: createId(), grantedAt: new Date().toISOString(), schemaRev: 3 }
    await db.stepExceptions.add(exception)
    set((state) => ({ exceptions: [...state.exceptions, exception] }))
    return exception
  },

  revokeException: async (id) => {
    await db.stepExceptions.delete(id)
    set((state) => ({ exceptions: state.exceptions.filter((item) => item.id !== id) }))
  },

  clearJointExceptions: async (jointTypeId) => {
    const stale = get().exceptions.filter((item) => item.jointTypeId === jointTypeId)
    if (stale.length === 0) return
    await db.stepExceptions.bulkDelete(stale.map((item) => item.id))
    set((state) => ({
      exceptions: state.exceptions.filter((item) => item.jointTypeId !== jointTypeId),
    }))
  },
}))
