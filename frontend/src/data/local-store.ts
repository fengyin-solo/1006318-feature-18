import { migrateStore } from './migration'
import { SEED_ROWS } from './seed'
import { todayStr } from './domain'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'

// 跨模块派生集合（隐患处置结论回写的待办、同步到应急演练的评估清单、重排演练计划），
// 与业务模块同库存放，同一事实源、一次事务保存，概览与各入口读到的永远是同一份。
export const TODO_KEY = '__hazardTodos__'
export const ASSESSMENT_KEY = '__emergencyAssessments__'
export const DRILL_PLAN_KEY = '__drillPlans__'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrateStore(fallback, todayStr())
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrateStore(fallback, todayStr())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = { ...clone(SEED_ROWS), ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
  } catch {
    const seeded = migrateStore(fallback, todayStr())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  // 首次打开新版时对存量数据做一次性回填（幂等），落库后退出再打开不再变动。
  const migrated = migrateStore(parsed, todayStr())
  if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  }
  return migrated
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 整块落库：一次保存多组集合，保证隐患主表与待办/评估清单是同一个事务版本。 */
export function saveAll(next: Record<string, EntryRow[]>): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  saveAll({ ...allRows(), [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 隐患口径变化涉及多张派生清单时，用它一次性提交，避免读到中间态。 */
export function savePatch(patch: Record<string, EntryRow[]>): void {
  saveAll({ ...allRows(), ...patch })
}

export function storageKey(): string {
  return STORAGE_KEY
}
