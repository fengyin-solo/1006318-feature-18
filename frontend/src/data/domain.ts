/**
 * 隐患整改域的统一口径：等级期限推定、逾期推导、状态归一化都集中在这里，
 * 列表、概览、导出、待办、应急评估清单只能读这里推导过的结果，不允许各算各的。
 */
import type { EntryRow } from './types'

// 隐患等级（按安全生产领域通行的四级口径）
export const HAZARD_LEVELS = ['重大', '较大', '一般', '低'] as const
export type HazardLevel = (typeof HAZARD_LEVELS)[number]

/**
 * 整改期限推定规则（自拟运维口径）：
 * 依据《安全生产事故隐患排查治理暂行规定》（原安监总局16号令）"分级治理、限期整改"的精神，
 * 结合城市地下综合管廊现场作业窗口，对没有明确整改期限的存量隐患按等级推定期限：
 *   重大  7 天（重大隐患须立即治理、最快闭环）
 *   较大 15 天
 *   一般 30 天
 *   低   60 天
 * 以发现日期为起算日。该规则是本平台的统一推定口径，推定时会在"回填备注"里标明，不覆盖原始值。
 */
export const DEADLINE_DAYS_BY_LEVEL: Record<HazardLevel, number> = {
  重大: 7,
  较大: 15,
  一般: 30,
  低: 60,
}

// 可归属、可提交的责任班组；观摩账号是纯只读入口
export const WORK_TEAMS = ['土建维保班', '机电运维班', '安消维保班', '给排水班'] as const
export const READONLY_TEAM = '观摩账号（只读）'
export const ALL_TEAMS = [...WORK_TEAMS, READONLY_TEAM]

export const HAZARD_STATUSES = ['待整改', '整改中', '已验收'] as const
export type HazardStatus = (typeof HAZARD_STATUSES)[number]
export const HAZARD_ACCEPTED: HazardStatus = '已验收'

export type HazardSummary = {
  total: number
  pendingRectify: number // 待整改
  rectifying: number // 整改中
  accepted: number // 已验收
  overdue: number // 逾期（待整改/整改中 且 整改期限早于今天）
  returned: number // 整改中且被退回过
  open: number // 未验收 = 待整改 + 整改中，必须与待办清单条数一致
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayStr(): string {
  return toDateStr(new Date())
}

export function parseDate(value: string | number | boolean | undefined): Date | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function addDays(value: string, days: number): string {
  const d = parseDate(value) ?? new Date()
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

export function maxDateStr(a: string, b: string): string {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da) return b
  if (!db) return a
  return da.getTime() >= db.getTime() ? a : b
}

export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const s = String(value).trim()
  if (s === '') return true
  // 骨架示例数据的占位文本视为残缺
  return s.includes('样例')
}

export function normalizeLevel(value: unknown): HazardLevel {
  const s = String(value ?? '').trim()
  return (HAZARD_LEVELS as readonly string[]).includes(s) ? (s as HazardLevel) : '一般'
}

/** 逾期是派生标记：只有未验收的隐患才可能逾期，验收通过当天即清除，不允许手工长期置位。 */
export function isOverdue(row: EntryRow, today: string = todayStr()): boolean {
  if (String(row.status) === HAZARD_ACCEPTED) return false
  const deadline = parseDate(String(row['整改期限'] ?? ''))
  const now = parseDate(today)
  if (!deadline || !now) return false
  return deadline.getTime() < now.getTime()
}

/**
 * 归一化一行隐患：状态位（status/pending/abnormal）与整改状态、逾期标记统一口径。
 * 返回新行，不改原值；是否落库由调用方决定。
 */
export function normalizeHazard(row: EntryRow, today: string = todayStr()): EntryRow {
  const status = (HAZARD_STATUSES as readonly string[]).includes(String(row.status))
    ? String(row.status)
    : '待整改'
  const overdue = status !== HAZARD_ACCEPTED && isOverdue(row, today)
  return {
    ...row,
    status,
    整改状态: status,
    pending: status !== HAZARD_ACCEPTED,
    abnormal: overdue,
  }
}

export function summarizeHazards(rows: EntryRow[], today: string = todayStr()): HazardSummary {
  const summary: HazardSummary = {
    total: rows.length,
    pendingRectify: 0,
    rectifying: 0,
    accepted: 0,
    overdue: 0,
    returned: 0,
    open: 0,
  }
  for (const raw of rows) {
    const row = normalizeHazard(raw, today)
    switch (row.status) {
      case '待整改':
        summary.pendingRectify += 1
        break
      case '整改中':
        summary.rectifying += 1
        if (Number(row['退回次数'] ?? 0) > 0) summary.returned += 1
        break
      case '已验收':
        summary.accepted += 1
        continue
    }
    if (isOverdue(row, today)) summary.overdue += 1
  }
  summary.open = summary.pendingRectify + summary.rectifying
  return summary
}

/** CSV 单元格转义：验收结论、整改措施里可能带逗号或换行。 */
export function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
