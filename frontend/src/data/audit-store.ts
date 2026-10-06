import type { AuditEntry } from './types'

// 留痕独立一份：append-only，不随业务数据重置而消失。
const AUDIT_KEY = 'urban-utility-tunnel:audit-log'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

let cache: AuditEntry[] | null = null

function readLog(): AuditEntry[] {
  if (cache !== null) return cache
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = []
    return cache
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    cache = []
    return cache
  }
  try {
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed) ? (parsed as AuditEntry[]) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(readLog()))
  }
}

export function listAudit(filter: { module?: string; refCode?: string } = {}): AuditEntry[] {
  let items = clone(readLog())
  if (filter.module) items = items.filter((e) => e.module === filter.module)
  if (filter.refCode) items = items.filter((e) => e.refCode === filter.refCode)
  return items.sort((a, b) => b.id - a.id)
}

export function addAudit(
  entry: Omit<AuditEntry, 'id' | 'time'> & { time?: string },
): AuditEntry {
  const logs = readLog()
  const next: AuditEntry = {
    id: logs.reduce((m, e) => Math.max(m, e.id), 0) + 1,
    time: entry.time ?? new Date().toISOString(),
    module: entry.module,
    refCode: entry.refCode,
    action: entry.action,
    operator: entry.operator,
    detail: entry.detail,
    batch: entry.batch,
  }
  logs.push(next)
  persist()
  return next
}

export function auditKey(): string {
  return AUDIT_KEY
}
