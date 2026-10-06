import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_NAME, MortiseDatabase } from './db'

const MIGRATION_DB = `${DB_NAME}-migration-test`
let migrated: MortiseDatabase | null = null

afterEach(async () => {
  if (migrated) {
    migrated.close()
    migrated = null
  }
  await Dexie.delete(MIGRATION_DB)
})

describe('Dexie v2 → v3 迁移', () => {
  it('旧步骤回填空的构件与前置（进入待补关系），并建立老师例外表', async () => {
    // 1. 用仅到 v2 的旧结构建库并写入一条旧格式步骤
    const legacy = new Dexie(MIGRATION_DB)
    legacy.version(1).stores({
      joints: 'id, name, family, difficulty',
      members: 'id, jointTypeId, name, part, lengthMm',
      steps: 'id, jointTypeId, seq, action',
      diagrams: 'id, jointTypeId, stepId, view',
      furniture: 'id, jointTypeId, name',
    })
    legacy.version(2).stores({
      joints: 'id, name, family, difficulty',
      members: 'id, jointTypeId, name, part, lengthMm',
      steps: 'id, jointTypeId, seq, action',
      diagrams: 'id, jointTypeId, stepId, view',
      furniture: 'id, jointTypeId, name',
    })
    await legacy.table('steps').add({
      id: 'legacy-step',
      jointTypeId: 'legacy-joint',
      seq: 1,
      action: '拆卸',
      direction: '轴向',
      tool: '木槌',
      riskNote: '旧步骤没有关联字段',
      holdSec: 6,
      schemaRev: 2,
    })
    legacy.close()

    // 2. 用当前 v3 结构打开，触发 upgrade
    migrated = new MortiseDatabase(MIGRATION_DB)
    const upgraded = await migrated.steps.get('legacy-step')

    expect(upgraded?.memberIds).toEqual([])
    expect(upgraded?.prerequisiteIds).toEqual([])
    expect(upgraded?.schemaRev).toBe(3)
    // 例外表已建立且可读写
    await migrated.stepExceptions.add({
      id: 'exc-migrated',
      jointTypeId: 'legacy-joint',
      stepId: 'legacy-step',
      code: 'tool-contention',
      reason: '迁移后可登记例外',
      grantedAt: '2026-10-06T00:00:00.000Z',
      basisFingerprint: 'fp',
    })
    expect(await migrated.stepExceptions.count()).toBe(1)
  })
})
