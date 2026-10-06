import { listRows, saveRows } from '@/data/local-store'
import { addAudit, listAudit } from '@/data/audit-store'
import {
  HAZARD_LEVELS,
  TEAMS,
  addDays,
  countHazards,
  deriveHazard,
  filterRows,
  formatDate,
  inferDeadline,
  isMissing,
  normalizeLevel,
  ownsHazard,
  parseDate,
  postponeDeadline,
  projectHazard,
  projectTodo,
  reconcile,
  todayStr,
  type TodoProjection,
} from '@/data/hazard-policy'
import type { ActionResult, AuditEntry, EntryRow } from '@/data/types'

const KEY = 'hazard'
const EMERGENCY_KEY = 'emergency'

// ── 读取：所有入口共用一份投影 ───────────────────────────────────────
export function listHazards(filters: Record<string, string> = {}, now: Date = new Date()): EntryRow[] {
  const projected = listRows(KEY).map((r) => projectHazard(r, now))
  // 投影产生的最新口径顺手落库（不改变 id 顺序），保证退出重开、别处读到的无差别。
  persistIfDrifted(projected)
  return filterRows(projected, filters)
}

export function getHazard(id: number, now: Date = new Date()): EntryRow | undefined {
  const row = listRows(KEY).find((r) => Number(r.id) === id)
  return row ? projectHazard(row, now) : undefined
}

export function hazardCounters(now: Date = new Date()) {
  return countHazards(listRows(KEY).map((r) => projectHazard(r, now)), now)
}

export function hazardReconcile(now: Date = new Date()) {
  return reconcile(listRows(KEY), now)
}

export function hazardAudit(id?: number, code?: string): AuditEntry[] {
  if (id !== undefined) {
    const row = listRows(KEY).find((r) => Number(r.id) === id)
    if (row) return listAudit({ module: KEY, refCode: String(row['隐患编号'] ?? '') })
  }
  if (code) return listAudit({ module: KEY, refCode: code })
  return listAudit({ module: KEY })
}

function persistIfDrifted(projected: EntryRow[]): void {
  const stored = listRows(KEY)
  if (stored.length !== projected.length) {
    saveRows(KEY, projected)
    return
  }
  let drifted = false
  const merged = stored.map((row, i) => {
    const p = projected[i]
    if (
      row.status !== p.status ||
      row.pending !== p.pending ||
      row.abnormal !== p.abnormal ||
      String(row['逾期'] ?? '') !== String(p['逾期']) ||
      String(row['整改状态'] ?? '') !== String(p['整改状态'])
    ) {
      drifted = true
      return { ...row, ...p }
    }
    return row
  })
  if (drifted) saveRows(KEY, merged)
}

function persist(rows: EntryRow[]): void {
  // 写库前统一过一遍派生口径，存储本身就始终是"那一份"。
  saveRows(
    KEY,
    rows.map((r) => projectHazard(r)),
  )
}

function nextHazardId(rows: EntryRow[]): number {
  return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1
}

function nextHazardCode(rows: EntryRow[]): string {
  let max = 0
  for (const r of rows) {
    const m = /^HAZA-(\d+)$/.exec(String(r['隐患编号'] ?? ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `HAZA-${String(max + 1).padStart(4, '0')}`
}

// ── 补录：缺项一并补齐；不提供的等级期限按规则推定 ────────────────────
export type HazardDraft = {
  part: string
  level: string
  measure: string
  owner: string
  team: string
  findDate: string
  deadline?: string
}

export function createHazard(draft: HazardDraft, operator: string, now: Date = new Date()): ActionResult & { id?: number } {
  // 必填项缺一项都不收，避免又产生口径残缺的存量。
  const required: [string, string][] = [
    ['隐患部位', draft.part],
    ['隐患等级', draft.level],
    ['整改措施', draft.measure],
    ['责任人员', draft.owner],
    ['责任班组', draft.team],
    ['发现日期', draft.findDate],
  ]
  const missing = required.filter(([, v]) => isMissing(v)).map(([k]) => k)
  if (missing.length > 0) {
    return { ok: false, message: `补录被拒：缺项 ${missing.join('、')} 必须一并补齐` }
  }
  if (!TEAMS.includes(draft.team as (typeof TEAMS)[number])) {
    return { ok: false, message: `补录被拒：责任班组「${draft.team}」不在登记班组内` }
  }
  const { level, assumed } = normalizeLevel(draft.level)
  if (!HAZARD_LEVELS.includes(level as (typeof HAZARD_LEVELS)[number])) {
    return { ok: false, message: `补录被拒：隐患等级「${draft.level}」无法辨认` }
  }
  if (parseDate(draft.findDate) === null) {
    return { ok: false, message: '补录被拒：发现日期格式应为 YYYY-MM-DD' }
  }
  let deadline = draft.deadline?.trim()
  if (!deadline) {
    deadline = inferDeadline(draft.findDate, level)
  } else if (parseDate(deadline) === null) {
    return { ok: false, message: '补录被拒：整改期限格式应为 YYYY-MM-DD' }
  }

  const rows = listRows(KEY)
  const id = nextHazardId(rows)
  const code = nextHazardCode(rows)
  const row: EntryRow = {
    id,
    status: '待整改',
    pending: true,
    abnormal: false,
    隐患编号: code,
    隐患部位: draft.part.trim(),
    隐患等级: level,
    整改措施: draft.measure.trim(),
    责任人员: draft.owner.trim(),
    责任班组: draft.team,
    发现日期: draft.findDate.trim(),
    整改期限: deadline,
    逾期: '正常',
    整改状态: '待整改',
  }
  rows.push(row)
  persist(rows)
  addAudit({
    module: KEY,
    refCode: code,
    action: '补录隐患',
    operator,
    detail:
      `补录${code}（${level}，班组${draft.team}，发现日期${draft.findDate}）；` +
      (assumed ? `等级「${draft.level}」按${level}推定；` : '') +
      (draft.deadline?.trim() ? '' : `整改期限缺项按规则推定为${deadline}`),
  })
  return { ok: true, message: `隐患 ${code} 已补录，整改期限 ${deadline}`, id }
}

// ── 派发整改：仅本责任班组可操作 ─────────────────────────────────────
export function dispatchHazard(id: number, team: string, operator: string): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((r) => Number(r.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的隐患记录` }
  const row = rows[index]
  if (!ownsHazard(row, team)) {
    return {
      ok: false,
      message: `按归属驳回：${row['隐患编号']} 归属${row['责任班组']}，当前班组${team}无权操作`,
    }
  }
  const d = deriveHazard(row)
  if (d.status === '已验收') return { ok: false, message: `${row['隐患编号']} 已验收，不能再派发` }
  if (d.status === '整改中') return { ok: false, message: `${row['隐患编号']} 已在整改中` }
  rows[index] = { ...projectHazard(row), status: '整改中', 整改状态: '整改中' }
  persist(rows)
  addAudit({
    module: KEY,
    refCode: String(row['隐患编号']),
    action: '派发整改',
    operator: `${operator}/${team}`,
    detail: `派发整改，期限${row['整改期限']}`,
  })
  return { ok: true, message: `${row['隐患编号']} 已派发整改` }
}

// ── 验收事务：结论一次落库 + 逾期清理 + 演练同步（同一次提交里完成） ──
export type AcceptDraft = {
  passed: boolean
  conclusion: string
  acceptor: string
}

export function acceptHazard(
  id: number,
  draft: AcceptDraft,
  team: string,
  operator: string,
  now: Date = new Date(),
): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((r) => Number(r.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的隐患记录` }
  const row = rows[index]
  const code = String(row['隐患编号'])

  // 归属鉴权：不是本责任班组的提交一律拒绝
  if (!ownsHazard(row, team)) {
    addAudit({
      module: KEY,
      refCode: code,
      action: draft.passed ? '越权验收拒绝' : '越权退回拒绝',
      operator: `${operator}/${team}`,
      detail: `提交被驳回：该隐患归属${row['责任班组']}，${team}为只读入口`,
    })
    return { ok: false, message: `按归属驳回：${code} 归属${row['责任班组']}，${team}入口只读` }
  }

  const d = deriveHazard(row, now)
  // 幂等：同一隐患重复提交验收只生效一次
  if (d.status === '已验收') {
    return { ok: false, message: `${code} 已验收（验收单号 ${row['验收单号'] ?? '—'}），重复提交不再生效` }
  }
  if (d.status !== '整改中' && d.status !== '退回重改') {
    return { ok: false, message: `${code} 当前为「${d.status}」，需先派发整改才能验收` }
  }
  if (isMissing(draft.conclusion)) {
    return { ok: false, message: '验收结论不能为空：结论要随验收一次性落库并同步演练' }
  }
  if (isMissing(draft.acceptor)) {
    return { ok: false, message: '验收人员不能为空' }
  }

  const level = normalizeLevel(row['隐患等级']).level
  let updated: EntryRow

  if (draft.passed) {
    updated = {
      ...projectHazard(row, now),
      status: '已验收',
      整改状态: '已验收',
      验收日期: todayStr(now),
      验收人员: draft.acceptor.trim(),
      验收结论: draft.conclusion.trim(),
      验收单号: nextAcceptNo(rows, now),
      // 逾期标记随验收清掉（deriveHazard 对已验收恒为 overdue=false）
    }
    updated = projectHazard(updated, now)
    rows[index] = updated
    persist(rows)
    addAudit({
      module: KEY,
      refCode: code,
      action: '验收通过',
      operator: `${draft.acceptor.trim()}/${team}`,
      detail:
        `验收通过，单号${updated['验收单号']}；结论：${draft.conclusion.trim()}；` +
        `原逾期标志${d.overdue ? '逾期→已清除' : '正常'}`,
    })
    syncToEmergency(updated, '验收通过', now)
    return { ok: true, message: `${code} 验收通过，逾期标记已清除，结论已同步演练评估清单` }
  }

  // 退回重改：整改期限顺延（不短于今天 + 等级 SLA），留痕
  const before = String(row['整改期限'] ?? '')
  const nextDeadline = postponeDeadline(before, level, now)
  updated = projectHazard(
    {
      ...row,
      status: '退回重改',
      整改状态: '退回重改',
      整改期限: nextDeadline,
      退回次数: Number(row['退回次数'] ?? 0) + 1,
      最近退回结论: draft.conclusion.trim(),
    },
    now,
  )
  rows[index] = updated
  persist(rows)
  addAudit({
    module: KEY,
    refCode: code,
    action: '退回重改',
    operator: `${draft.acceptor.trim()}/${team}`,
    detail:
      `验收退回（第${updated['退回次数']}次）：${draft.conclusion.trim()}；` +
      `整改期限顺延：${before} → ${nextDeadline}（${level}隐患限期口径）`,
  })
  syncToEmergency(updated, '退回重改', now)
  return { ok: true, message: `${code} 已退回重改，整改期限顺延至 ${nextDeadline}（已留痕）` }
}

function nextAcceptNo(rows: EntryRow[], now: Date): string {
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `YS-${ym}-`
  let seq = 0
  for (const r of rows) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(r['验收单号'] ?? ''))
    if (m) seq = Math.max(seq, Number(m[1]))
  }
  return `${prefix}${String(seq + 1).padStart(3, '0')}`
}

/**
 * 验收结论同步应急演练评估清单：同一隐患编号只维护一条（upsert），
 * 重验更新原条目不新增待办；没有关联条目时按验收日 +3 天排一次演练。
 */
function syncToEmergency(hazard: EntryRow, result: '验收通过' | '退回重改', now: Date): ActionResult {
  const rows = listRows(EMERGENCY_KEY)
  const code = String(hazard['隐患编号'])
  const level = String(hazard['隐患等级'])
  const part = String(hazard['隐患部位'])
  const team = String(hazard['责任班组'])
  const stamp = now.toISOString()
  const conclusion =
    result === '验收通过'
      ? String(hazard['验收结论'])
      : `退回重改（第${hazard['退回次数']}次）：${hazard['最近退回结论']}`
  const snapshot = `[${level}] ${part}（${code}）${result === '验收通过' ? `${hazard['验收日期']} 验收通过` : `${todayStr(now)} 退回重改，期限顺延至${hazard['整改期限']}`}`

  const index = rows.findIndex((r) => String(r['关联隐患编号'] ?? '') === code)
  if (index >= 0) {
    const old = rows[index]
    // 已评估的演练也更新结论，并重新排一场（演练那边要按最新隐患情况再排一次）
    const rePlan = String(old['演练状态'] ?? old.status) === '已评估'
    rows[index] = {
      ...old,
      评估结论: conclusion,
      隐患快照: snapshot,
      同步时间: stamp,
      演练场景: `隐患整改复核：${part}`,
      ...(rePlan
        ? {
            status: '待组织',
            pending: true,
            abnormal: false,
            演练状态: '待组织',
            计划日期: formatDate(addDays(now, 3)),
          }
        : {}),
    }
    saveRows(EMERGENCY_KEY, rows)
    addAudit({
      module: EMERGENCY_KEY,
      refCode: code,
      action: '演练清单更新',
      operator: `系统同步/${team}`,
      detail: rePlan
        ? `原演练已评估，按最新隐患情况重排，计划日期${rows[index]['计划日期']}；${snapshot}`
        : `结论更新（不新增条目）：${snapshot}`,
    })
    return { ok: true, message: rePlan ? '已按最新隐患重排演练' : '演练评估清单已更新' }
  }

  const id = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1
  rows.push({
    id,
    status: '待组织',
    pending: true,
    abnormal: false,
    演练编号: `EMER-AUTO-${String(id).padStart(4, '0')}`,
    演练场景: `隐患整改复核：${part}`,
    参与班组: team,
    计划日期: formatDate(addDays(now, 3)),
    演练时长: '2小时',
    评估结论: conclusion,
    组织人员: '值班管理员',
    演练状态: '待组织',
    关联隐患编号: code,
    隐患快照: snapshot,
    同步时间: stamp,
  })
  saveRows(EMERGENCY_KEY, rows)
  addAudit({
    module: EMERGENCY_KEY,
    refCode: code,
    action: '排入演练计划',
    operator: `系统同步/${team}`,
    detail: `验收结论同步，按最新隐患情况排入${formatDate(addDays(now, 3))}演练：${snapshot}`,
  })
  return { ok: true, message: '已排入演练计划' }
}

/** 演练侧手动"按隐患重排"：只读最新隐患快照后重排一场。 */
export function replanFromHazard(hazardCode: string, operator: string, now: Date = new Date()): ActionResult {
  const hazard = listRows(KEY).find((r) => String(r['隐患编号']) === hazardCode)
  if (!hazard) return { ok: false, message: `找不到关联隐患 ${hazardCode}` }
  const d = deriveHazard(hazard, now)
  if (d.status !== '已验收') {
    return { ok: false, message: `${hazardCode} 尚未验收通过，暂不按其重排演练` }
  }
  return syncToEmergency(projectHazard(hazard, now), '验收通过', now)
}

// ── 整改待办（另一入口）：1:1 投影，不另存 ───────────────────────────
export function listTodos(filters: Record<string, string> = {}, now: Date = new Date()): TodoProjection[] {
  const all = listRows(KEY).map((r) => projectTodo(projectHazard(r, now), now))
  return filterRows(
    all.map((t) => ({ ...t }) as unknown as EntryRow),
    filters,
  ).map((r) => r as unknown as TodoProjection)
}

/** 待办总条数（与隐患清单结构性相等，给两边页脚对账用）。 */
export function todoCounts(now: Date = new Date()) {
  const all = listRows(KEY).map((r) => projectTodo(projectHazard(r, now), now))
  return {
    total: all.length,
    open: all.filter((t) => t.status !== '已验收').length,
    overdue: all.filter((t) => t.overdue).length,
    closed: all.filter((t) => t.status === '已验收').length,
  }
}

// ── 导出：与列表同一投影、同一过滤口径 ───────────────────────────────
const EXPORT_COLUMNS = [
  '隐患编号', '隐患部位', '隐患等级', '整改措施', '责任人员', '责任班组',
  '发现日期', '整改期限', '逾期', '验收日期', '验收人员', '验收单号',
  '验收结论', '退回次数', '整改状态',
]

export function exportHazards(filters: Record<string, string> = {}, now: Date = new Date()): { filename: string; content: string } {
  const rows = listHazards(filters, now)
  const header = EXPORT_COLUMNS.join(',')
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) => EXPORT_COLUMNS.map((c) => esc(r[c])).join(','))
  return {
    filename: '隐患整改管理-清单.csv',
    content: `${String.fromCharCode(0xfeff)}${[header, ...lines].join('\n')}`,
  }
}

export function exportColumns(): string[] {
  return [...EXPORT_COLUMNS]
}

// 供演练页取最新隐患快照
export function latestHazardsForEmergency(now: Date = new Date()): EntryRow[] {
  return listRows(KEY)
    .map((r) => projectHazard(r, now))
    .filter((r) => r.status === '已验收' || r.status === '退回重改')
}
