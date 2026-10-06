import type { EntryRow } from '@/data/types'

/**
 * 隐患整改统一口径（纯函数，所有入口共用）
 *
 * 列表、概览、导出、整改待办、应急演练同步读到的都是这一份规则，
 * 任何页面都不允许自己另算一遍状态或逾期。
 */

// ── 等级与整改期限推定 ───────────────────────────────────────────────
// 依据：《生产安全事故隐患排查治理暂行规定》（原国家安全监管总局令第16号）
//   - 重大事故隐患：由主要负责人组织制定并实施治理方案，须限期治理（实务中一般要求一个月内）；
//   - 一般事故隐患：发现后立即整改。
// 结合城市综合管廊运维处置实际（动焊、动火、进舱作业需排程），采用下面这档日历天：
export const LEVEL_SLA_DAYS: Record<string, number> = {
  重大: 30,
  较大: 15,
  一般: 7,
  较低: 3,
}
export const HAZARD_LEVELS = ['重大', '较大', '一般', '较低'] as const
/** 等级残缺时按"一般"推定：既不按重大无限占用整改资源，也不按较低放松要求。 */
export const FALLBACK_LEVEL = '一般'

export const HAZARD_STATUS = ['待整改', '整改中', '已验收', '退回重改'] as const

/** 班组清单与演示用默认班组（与 session store 保持一致）。 */
export const TEAMS = ['土建一班', '机电二班', '消防三班', '巡检四班'] as const
export const DEFAULT_TEAM = '土建一班'

export function todayStr(now: Date = new Date()): string {
  return formatDate(now)
}

export function formatDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  // 用正午构造，避开部分时区夏令时切换造成的日期漂移（只做日期级比较）。
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return Number.isNaN(d.getTime()) ? null : d
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12)
}

/** 日期级比较用的归一化串（YYYY-MM-DD），杜绝时区把"今天"算成昨天。 */
export function dateKey(d: Date): string {
  return formatDate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12))
}

/** 占位/残缺值：生成器产出的"xx样例N"以及空串一律视为缺项，回填和补录都要补。 */
export function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true
  const s = String(value).trim()
  if (s === '') return true
  return /样例\d+$/.test(s)
}

/** 归一化等级文案；无法辨认的残缺等级按 FALLBACK_LEVEL 处理（并在外层留痕）。 */
export function normalizeLevel(raw: unknown): { level: string; assumed: boolean } {
  const s = String(raw ?? '').trim()
  const hit = HAZARD_LEVELS.find((lv) => s.includes(lv))
  if (hit) return { level: hit, assumed: false }
  if (/重大|严重/.test(s)) return { level: '重大', assumed: false }
  if (/较大/.test(s)) return { level: '较大', assumed: false }
  if (/较低|轻微|一般低/.test(s)) return { level: '较低', assumed: false }
  return { level: FALLBACK_LEVEL, assumed: true }
}

/** 以发现日期为轴推定整改期限：发现日 + 等级 SLA（自然日）。 */
export function inferDeadline(findDate: unknown, level: string): string {
  const base = parseDate(findDate) ?? new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12)
  return formatDate(addDays(base, LEVEL_SLA_DAYS[level] ?? LEVEL_SLA_DAYS[FALLBACK_LEVEL]))
}

/**
 * 退回重改顺延期：新期限 = max(旧期限, 今天) + 同等级 SLA。
 * 旧期限可能已经耗完（逾期退回），不能在过去的日期上继续加，所以先钳到今天。
 */
export function postponeDeadline(oldDeadline: unknown, level: string, now: Date = new Date()): string {
  const today = now
  const old = parseDate(oldDeadline)
  const base = old && dateKey(old) > dateKey(today) ? old : today
  return formatDate(addDays(base, LEVEL_SLA_DAYS[level] ?? LEVEL_SLA_DAYS[FALLBACK_LEVEL]))
}

// ── 统一派生：状态、逾期、待办标志 ────────────────────────────────────
export type DerivedHazard = {
  status: string
  overdue: boolean
  pending: boolean
  abnormal: boolean
}

/**
 * 所有口径都由这里出：
 * - status 只可能是 待整改/整改中/退回重改/已验收，"已逾期"不再作为独立状态；
 * - overdue = 未验收且整改期限早于今天（验收当天不算逾期）；
 * - pending = 还没验收完；abnormal = 逾期 或 退回重改（看板异常量）。
 */
export function deriveHazard(row: Pick<EntryRow, 'status'> & Record<string, unknown>, now: Date = new Date()): DerivedHazard {
  const raw = String(row.status ?? '').trim()
  const accepted = raw === '已验收'
  let status = raw
  if (!HAZARD_STATUS.includes(raw as (typeof HAZARD_STATUS)[number])) {
    // 老口径兼容：历史上的"已逾期"归入整改中，逾期由 deadline 重新派生
    status = '整改中'
  }
  const deadline = parseDate(row['整改期限'])
  const overdue = !accepted && deadline !== null && dateKey(deadline) < dateKey(now)
  const returned = status === '退回重改'
  return {
    status,
    overdue,
    pending: !accepted,
    abnormal: overdue || returned,
  }
}

/** 把派口径落到行上（读时投影，存储里也始终保持最新）。 */
export function projectHazard(row: EntryRow, now: Date = new Date()): EntryRow {
  const d = deriveHazard(row, now)
  return {
    ...row,
    status: d.status,
    整改状态: d.status,
    逾期: d.overdue ? '逾期' : '正常',
    pending: d.pending,
    abnormal: d.abnormal,
  }
}

// ── 处置结论 → 整改待办（另一入口）的 1:1 投影 ─────────────────────────
export type TodoProjection = {
  id: number
  code: string
  part: string
  level: string
  team: string
  deadline: string
  overdue: boolean
  status: string
  conclusion: string
  sourceStatus: string
}

/**
 * 待办不单独存储，始终由隐患表投影：隐患多少条待办就多少条，
 * 处置结论回写在隐患行上，两边条数由结构保证一致（不是靠同步逻辑碰一致）。
 */
export function projectTodo(row: EntryRow, now: Date = new Date()): TodoProjection {
  const d = deriveHazard(row, now)
  return {
    id: Number(row.id),
    code: String(row['隐患编号'] ?? ''),
    part: String(row['隐患部位'] ?? ''),
    level: String(row['隐患等级'] ?? ''),
    team: String(row['责任班组'] ?? ''),
    deadline: String(row['整改期限'] ?? ''),
    overdue: d.overdue,
    status: d.status,
    conclusion: d.status === '已验收' ? String(row['验收结论'] ?? '') : '',
    sourceStatus: d.status,
  }
}

// ── 过滤（供两个 service 共用，避免循环依赖） ─────────────────────────
export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) return rows
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// ── 班组归属鉴权 ─────────────────────────────────────────────────────
export function ownsHazard(row: EntryRow, team: string): boolean {
  return String(row['责任班组'] ?? '') === team
}

// ── 报表 ↔ 明细 对账：任何页面要数都用它，不自己 filter 出第二份 ─────
export type HazardCounters = {
  total: number
  waiting: number
  rectifying: number
  returned: number
  accepted: number
  overdue: number
  pendingTodo: number
}

export function countHazards(rows: EntryRow[], now: Date = new Date()): HazardCounters {
  const c: HazardCounters = {
    total: 0,
    waiting: 0,
    rectifying: 0,
    returned: 0,
    accepted: 0,
    overdue: 0,
    pendingTodo: 0,
  }
  for (const r of rows) {
    const d = deriveHazard(r, now)
    c.total += 1
    if (d.status === '待整改') c.waiting += 1
    if (d.status === '整改中') c.rectifying += 1
    if (d.status === '退回重改') c.returned += 1
    if (d.status === '已验收') c.accepted += 1
    if (d.overdue) c.overdue += 1
    if (d.pending) c.pendingTodo += 1
  }
  return c
}

/**
 * 报表对账：卡片数之和 = 明细总数；待办条数 = 隐患总数（1:1 投影）；
 * 逾期卡片数 = 明细里逾期标记数；状态标志 = 统一派生。
 */
export function reconcile(rows: EntryRow[], now: Date = new Date()): {
  ok: boolean
  checks: { name: string; expected: number; actual: number; ok: boolean }[]
} {
  const projected = rows.map((r) => projectHazard(r, now))
  const c = countHazards(projected, now)
  const todoCount = projected.length // 待办是 1:1 投影，未验收条数由 pendingTodo 出
  const storedOverdue = projected.filter((r) => String(r['逾期']) === '逾期').length
  const checks = [
    { name: '状态卡片合计 = 明细总数', expected: c.total, actual: c.waiting + c.rectifying + c.returned + c.accepted, ok: false },
    { name: '待办清单条数 = 隐患明细总数', expected: c.total, actual: todoCount, ok: false },
    { name: '逾期卡片数 = 明细逾期标记数', expected: c.overdue, actual: storedOverdue, ok: false },
    { name: '待办未结条数 = 未验收隐患数', expected: c.pendingTodo, actual: c.total - c.accepted, ok: false },
  ].map((x) => ({ ...x, ok: x.expected === x.actual }))
  return { ok: checks.every((x) => x.ok), checks }
}
