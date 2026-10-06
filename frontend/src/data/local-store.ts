import { SEED_ROWS } from './seed'
import { runMigrations, MIGRATION_VERSION } from './migrations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const VERSION_KEY = 'urban-utility-tunnel:schema-version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedSnapshot(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function migrate(data: Record<string, EntryRow[]>, fromVersion: number, reason: string): Record<string, EntryRow[]> {
  const { data: next } = runMigrations(data, fromVersion, reason)
  return next
}

function writeStorage(data: Record<string, EntryRow[]>, version: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  window.localStorage.setItem(VERSION_KEY, String(version))
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    // 无 localStorage 环境：内存里也按最新版口径过一遍。
    return migrate(seedSnapshot(), 0, '无持久化环境初始化')
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    // 首次打开：种子数据也要按存量口径回填一次，保证口径从第一天就统一。
    const seeded = migrate(seedSnapshot(), 0, '首次播种')
    writeStorage(seeded, MIGRATION_VERSION)
    return seeded
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    const fallback = migrate(seedSnapshot(), 0, '存储损坏重置')
    writeStorage(fallback, MIGRATION_VERSION)
    return fallback
  }
  const fromVersion = Number(window.localStorage.getItem(VERSION_KEY) ?? '0') || 0
  if (fromVersion < MIGRATION_VERSION) {
    const next = migrate(parsed, fromVersion, `v${fromVersion}→v${MIGRATION_VERSION}存量升级`)
    writeStorage(next, MIGRATION_VERSION)
    return next
  }
  return parsed
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

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/** 重置某模块：重置后同样要跑迁移（种子是旧口径，得回填成统一口径）。 */
export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const { data: migrated } = runMigrations({ [key]: rows }, 0, `重置模块${key}`)
  const nextRows = migrated[key] ?? []
  saveRows(key, nextRows)
  return nextRows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export { MIGRATION_VERSION }
