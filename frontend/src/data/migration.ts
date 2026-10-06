/**
 * 一次性存量回填（历史口径对齐）。
 *
 * 两类回填，互相独立、各自留痕、幂等（已回填的行不再改动，原值一律保留）：
 *
 * 1. 隐患按发现日期回填：
 *    - 等级残缺 → 推定「一般」；
 *    - 责任班组残缺 → 推定默认责任班组「土建维保班」；
 *    - 整改期限残缺 → 按等级推定（重大7/较大15/一般30/低60 天），自发现日期起算。
 *    依据见 domain.ts 中 DEADLINE_DAYS_BY_LEVEL 的注释。
 *
 * 2. 历史单据（渗漏水处置单、设施检修记录）以完工日期为轴回填一次：
 *    - 仅处理「已完工」历史单据；未完工的是在办业务，不拿历史模板套；
 *    - 以完工年份归版，同年存在一份字段完整的「当年版」单据时用它做模板；
 *      同年没有完整版时，取年份最近的完整版兜底（年份差最小）；
 *    - 残缺字段从模板补齐；完工日期本身残缺的，按发现日期加该类单据的
 *      典型工期推定（渗漏处置 14 天、设施检修 7 天），并参与定版；
 *    - 每张单据补了什么、用的哪一版，写进「回填备注」，历史原值不动。
 */
import {
  addDays,
  DEADLINE_DAYS_BY_LEVEL,
  isBlankValue,
  normalizeHazard,
  normalizeLevel,
  parseDate,
  toDateStr,
  WORK_TEAMS,
} from './domain'
import type { EntryRow } from './types'

export const BACKFILL_MARK = '存量回填v1'
export const HISTORY_MARK = '历史回填v1'

const DEFAULT_HAZARD_TEAM = WORK_TEAMS[0] // 早年未登记归属班组的，统一推定给土建维保班

type CompletableSpec = {
  key: string
  dateField: string // 定版轴：完工日期
  foundField: string // 完工日期缺失时的起算字段
  typicalDays: number
  fillFields: string[]
}

const HISTORY_SPECS: CompletableSpec[] = [
  {
    key: 'leak',
    dateField: '完工日期',
    foundField: '发现日期',
    typicalDays: 14,
    fillFields: ['渗漏程度', '处置方式', '处置班组'],
  },
  {
    key: 'maintenance',
    dateField: '完工日期',
    foundField: '发现日期',
    typicalDays: 7,
    fillFields: ['检修类别', '检修班组', '计划工期', '更换部件'],
  },
]

function appendNote(row: EntryRow, mark: string, note: string): EntryRow {
  const prev = String(row['回填备注'] ?? '').trim()
  const stamp = `${mark}：${note}`
  return { ...row, 回填备注: prev ? `${prev}；${stamp}` : stamp }
}

/** 隐患存量回填：按发现日期 + 等级推定口径补齐等级、归属班组与整改期限。 */
export function repairHazardRow(raw: EntryRow, today: string): EntryRow {
  if (String(raw['回填备注'] ?? '').includes(BACKFILL_MARK)) {
    return normalizeHazard(raw, today)
  }
  let row = { ...raw }
  const notes: string[] = []

  if (isBlankValue(row['隐患等级'])) {
    row['隐患等级'] = '一般'
    notes.push('等级残缺按「一般」登记')
  }
  const level = normalizeLevel(row['隐患等级'])
  if (String(row['隐患等级']) !== level) {
    row['隐患等级'] = level
    notes.push(`等级口径校正为「${level}」`)
  }

  if (isBlankValue(row['责任班组'])) {
    row['责任班组'] = DEFAULT_HAZARD_TEAM
    notes.push(`归属班组残缺推定「${DEFAULT_HAZARD_TEAM}」`)
  }

  if (isBlankValue(row['整改期限'])) {
    const found = String(row['发现日期'] ?? '')
    if (parseDate(found)) {
      const days = DEADLINE_DAYS_BY_LEVEL[level]
      row['整改期限'] = addDays(found, days)
      notes.push(`整改期限按${level}隐患推定${days}天（自发现日期起算）`)
    } else {
      notes.push('发现日期缺失，整改期限待人工补录')
    }
  }

  if (notes.length > 0) {
    row = appendNote(row, BACKFILL_MARK, notes.join('；'))
  }
  return normalizeHazard(row, today)
}

function yearOf(value: unknown): number | null {
  return parseDate(String(value ?? ''))?.getFullYear() ?? null
}

/** 历史单据回填：以完工日期为轴定版，残缺取值按「当年那版」补齐。 */
function backfillHistory(rows: EntryRow[], spec: CompletableSpec, today: string): EntryRow[] {
  const completed = rows.filter((row) => String(row.status) === '已完工')

  // 每个年份一份「当年版」：该年字段最齐全的已完工单据。
  const editions = new Map<number, EntryRow>()
  for (const row of completed) {
    const year = yearOf(row[spec.dateField])
    if (year === null) continue
    const completeCount = spec.fillFields.filter((f) => !isBlankValue(row[f])).length
    const current = editions.get(year)
    const currentCount = current
      ? spec.fillFields.filter((f) => !isBlankValue(current[f])).length
      : -1
    if (completeCount > currentCount) editions.set(year, row)
  }
  const editionYears = [...editions.keys()]

  function pickEdition(year: number): { donor: EntryRow; editionYear: number } | null {
    if (editionYears.length === 0) return null
    const exact = editions.get(year)
    if (exact) return { donor: exact, editionYear: year }
    let nearest = editionYears[0]
    for (const y of editionYears) {
      if (Math.abs(y - year) < Math.abs(nearest - year)) nearest = y
    }
    return { donor: editions.get(nearest)!, editionYear: nearest }
  }

  return rows.map((raw) => {
    if (String(raw.status) !== '已完工') return raw
    if (String(raw['回填备注'] ?? '').includes(HISTORY_MARK)) return raw

    let row = { ...raw }
    const notes: string[] = []
    let editionYear: number | null = yearOf(row[spec.dateField])

    // 完工日期残缺：先按典型工期推定，再拿推定年份去定版。
    if (editionYear === null) {
      const found = String(row[spec.foundField] ?? '')
      if (parseDate(found)) {
        row[spec.dateField] = addDays(found, spec.typicalDays)
        editionYear = yearOf(row[spec.dateField])
        notes.push(`${spec.dateField}残缺按发现日期+${spec.typicalDays}天推定`)
      }
    }

    const missing = spec.fillFields.filter((f) => isBlankValue(row[f]))
    if (missing.length > 0 && editionYear !== null) {
      const picked = pickEdition(editionYear)
      if (picked) {
        for (const field of missing) {
          const value = picked.donor[field]
          if (!isBlankValue(value)) row[field] = value
        }
        const filled = missing.filter((f) => !isBlankValue(row[f]))
        if (filled.length > 0) {
          notes.push(`按${picked.editionYear}年版补齐「${filled.join('、')}」`)
        }
      }
    }

    if (notes.length > 0) {
      row = appendNote(row, HISTORY_MARK, notes.join('；'))
      row['回填日期'] = today
    }
    return row
  })
}

/** 对整个本地库执行一次回填（幂等），返回是否有改动。 */
export function migrateStore(
  store: Record<string, EntryRow[]>,
  today: string,
): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = { ...store }
  next.hazard = (store.hazard ?? []).map((row) => repairHazardRow(row, today))
  for (const spec of HISTORY_SPECS) {
    next[spec.key] = backfillHistory(store[spec.key] ?? [], spec, today)
  }
  return next
}

// 供工具/测试复用：把日期转成 yyyy-MM-dd
export { toDateStr }
