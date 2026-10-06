/**
 * 隐患整改域服务：全平台隐患口径的唯一入口。
 *
 * 列表、概览、导出、整改待办、应急演练评估清单都只能从这里取数，
 * 任何一次状态流转都在同一个事务里落库（隐患主表 + 待办 + 评估清单 + 演练计划），
 * 因此「退出再打开、两处看到的没有差别」「处置结论与待办条数一致」是结构性保证。
 */
import {
  ASSESSMENT_KEY,
  DRILL_PLAN_KEY,
  TODO_KEY,
  allRows,
  listRows,
  savePatch,
} from '@/data/local-store'
import {
  addDays,
  csvCell,
  DEADLINE_DAYS_BY_LEVEL,
  HAZARD_ACCEPTED,
  isOverdue,
  maxDateStr,
  normalizeHazard,
  normalizeLevel,
  summarizeHazards,
  todayStr,
  WORK_TEAMS,
} from '@/data/domain'
import type {
  ActionContext,
  ActionResult,
  AssessmentRow,
  DrillPlanRow,
  EntryRow,
  PageResult,
  TodoRow,
} from '@/data/types'

type LogEntry = {
  time: string
  action: string
  team: string
  operator: string
  detail: string
  deadlineBefore?: string
  deadlineAfter?: string
}

const LOG_FIELD = '流转留痕'
const ACTIVE_PLAN_ID = 1 // 始终只有一份生效中的重排演练计划，旧的留痕为「已重排」

export function hazardRows(today: string = todayStr()): EntryRow[] {
  // 读时归一化：逾期是随日期滚动的派生标记，不能靠一次性写入冻结住。
  return listRows('hazard').map((row) => normalizeHazard(row, today))
}

export function findHazard(id: number, today: string = todayStr()): EntryRow | undefined {
  return hazardRows(today).find((row) => Number(row.id) === id)
}

export function hazardSummary(today: string = todayStr()) {
  return summarizeHazards(listRows('hazard'), today)
}

export function listHazards(
  filters: Record<string, string> = {},
  today: string = todayStr(),
): PageResult {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = hazardRows(today).filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function readLogs(row: EntryRow): LogEntry[] {
  try {
    const parsed = JSON.parse(String(row[LOG_FIELD] ?? '[]'))
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : []
  } catch {
    return []
  }
}

function withLog(row: EntryRow, entry: LogEntry): EntryRow {
  return { ...row, [LOG_FIELD]: JSON.stringify([...readLogs(row), entry]) }
}

export function hazardTrail(row: EntryRow): LogEntry[] {
  return readLogs(row)
}

// ── 班组归属鉴权：不是本责任班组的提交一律拒绝，只读入口（观摩账号）不允许任何改动 ──

function canWrite(ctx: ActionContext | undefined): ActionResult | null {
  if (!ctx) return { ok: false, message: '缺少操作者上下文，提交已按归属驳回' }
  if (!WORK_TEAMS.includes(ctx.team as (typeof WORK_TEAMS)[number])) {
    return { ok: false, message: `${ctx.team}为只读入口，隐患提交一律驳回` }
  }
  return null
}

function assertOwner(row: EntryRow, ctx: ActionContext): ActionResult | null {
  const denied = canWrite(ctx)
  if (denied) return denied
  if (String(row['责任班组'] ?? '') !== ctx.team) {
    return {
      ok: false,
      message: `该隐患归属「${row['责任班组']}」，${ctx.team}越权提交按归属驳回`,
    }
  }
  return null
}

// ── 派生清单：待办、评估清单、演练计划 ──

function todoTitle(row: EntryRow): string {
  const level = String(row['隐患等级'])
  const deadline = String(row['整改期限'] ?? '')
  const returned = Number(row['退回次数'] ?? 0) > 0
  return `【${level}】${row['隐患部位']} ${returned ? '退回重改' : '限期整改'}（期限 ${deadline}）`
}

/** 待办与隐患主表严格对账：未验收隐患一条不多一条不少。 */
function reconcileTodos(hazards: EntryRow[], today: string): TodoRow[] {
  const existing = new Map(
    (listRows(TODO_KEY) as TodoRow[]).map((row) => [Number(row['隐患id']), row]),
  )
  let seq = Math.max(0, ...[...existing.values()].map((row) => Number(row.id)))
  const todos: TodoRow[] = []
  for (const h of hazards) {
    const open = h.status !== HAZARD_ACCEPTED
    const old = existing.get(Number(h.id))
    const base: TodoRow = old ?? {
      id: ++seq,
      status: '待办',
      pending: true,
      abnormal: false,
      隐患id: Number(h.id),
      待办标题: '',
      责任班组: '',
      验收结论: '',
      隐患编号: String(h['隐患编号']),
    }
    const next: TodoRow = {
      ...base,
      status: open ? '待办' : '已核销',
      pending: open,
      abnormal: open && isOverdue(h, today),
      待办标题: todoTitle(h),
      隐患编号: String(h['隐患编号']),
      隐患等级: String(h['隐患等级']),
      责任班组: String(h['责任班组']),
      整改期限: String(h['整改期限'] ?? ''),
      验收结论: open ? '' : String(h['验收结论'] ?? '验收通过'),
      验收日期: open ? '' : String(h['验收日期'] ?? ''),
    }
    todos.push(next)
  }
  return todos
}

export function listTodos(today: string = todayStr()): TodoRow[] {
  return listRows(TODO_KEY) as TodoRow[]
}

/** 评估清单以「隐患id#验收序号」为幂等键，由流转留痕重建，重复提交永远不会多一条。 */
function reconcileAssessments(hazards: EntryRow[]): AssessmentRow[] {
  const existing = new Map(
    (listRows(ASSESSMENT_KEY) as AssessmentRow[]).map((row) => [
      `${row['隐患id']}#${row['验收序号']}`,
      row,
    ]),
  )
  let seq = Math.max(0, ...[...existing.values()].map((row) => Number(row.id)))
  const result: AssessmentRow[] = []
  for (const h of hazards) {
    const acceptedTimes = Number(h['验收次数'] ?? 0)
    // 已验收隐患至少有一次通过结论；存量历史隐患没有留痕时按验收字段补登一条。
    if (acceptedTimes === 0 && h.status === HAZARD_ACCEPTED && h['验收日期']) {
      const key = `${h.id}#1`
      const row =
        existing.get(key) ??
        ({
          id: ++seq,
          status: '待评估',
          pending: true,
          abnormal: false,
        } as AssessmentRow)
      result.push({
        ...row,
        隐患id: Number(h.id),
        隐患编号: String(h['隐患编号']),
        隐患部位: String(h['隐患部位']),
        隐患等级: String(h['隐患等级']),
        验收序号: 1,
        验收结论: String(h['验收结论'] ?? '验收通过'),
        验收日期: String(h['验收日期']),
        验收班组: String(h['验收班组'] ?? h['责任班组']),
        退回原因: '',
        同步时间: row['同步时间'] ?? String(h['验收日期']),
      })
      continue
    }
    const logs = readLogs(h).filter((log) => log.action === '验收通过' || log.action === '退回重改')
    logs.forEach((log, index) => {
      const key = `${h.id}#${index + 1}`
      const passed = log.action === '验收通过'
      const row =
        existing.get(key) ??
        ({
          id: ++seq,
          status: '待评估',
          pending: true,
          abnormal: false,
        } as AssessmentRow)
      result.push({
        ...row,
        隐患id: Number(h.id),
        隐患编号: String(h['隐患编号']),
        隐患部位: String(h['隐患部位']),
        隐患等级: String(h['隐患等级']),
        验收序号: index + 1,
        验收结论: passed ? '验收通过' : '退回重改',
        验收日期: log.time.slice(0, 10),
        验收班组: log.team,
        退回原因: passed ? '' : log.detail,
        同步时间: log.time,
      })
    })
  }
  return result.sort((a, b) => String(a['同步时间']).localeCompare(String(b['同步时间'])))
}

export function listAssessments(): AssessmentRow[] {
  return listRows(ASSESSMENT_KEY) as AssessmentRow[]
}

/** 每次验收后按最新未验收隐患情况重排一次演练；旧计划留痕为「已重排」。 */
function arrangeDrill(hazards: EntryRow[], triggerDate: string, today: string): DrillPlanRow[] {
  const open = hazards.filter((row) => row.status !== HAZARD_ACCEPTED)
  const plans = [...(listRows(DRILL_PLAN_KEY) as DrillPlanRow[])]
  for (const plan of plans) {
    if (Number(plan.id) === ACTIVE_PLAN_ID && plan.status === '待组织') {
      plan.status = '已重排'
      plan.pending = false
    }
  }
  let seq = plans.length
  const rank = ['重大', '较大', '一般', '低']
  const top = [...open].sort(
    (a, b) =>
      rank.indexOf(String(a['隐患等级'])) - rank.indexOf(String(b['隐患等级'])) ||
      String(a['整改期限']).localeCompare(String(b['整改期限'])),
  )
  const focus = top.slice(0, 3).map((row) => `${row['隐患部位']}（${row['隐患等级']}）`)
  const teams = [...new Set(open.map((row) => String(row['责任班组'])).filter(Boolean))]
  const plan: DrillPlanRow = {
    id: ACTIVE_PLAN_ID,
    status: '待组织',
    pending: true,
    abnormal: false,
    计划编号: `DRIL-AUTO-${String(seq + 1).padStart(3, '0')}`,
    演练场景:
      open.length > 0
        ? `按最新隐患重排：聚焦${focus.join('、')}${open.length > 3 ? ` 等${open.length}项未验收隐患` : ''}`
        : '隐患已清零，安排综合复盘演练',
    关联隐患数: open.length,
    涉及班组: teams.join('、'),
    建议日期: addDays(triggerDate, 14),
    触发验收日期: triggerDate,
    重排时间: `${today} ${new Date().toTimeString().slice(0, 8)}`,
  }
  plans.push(plan)
  return plans
}

export function listDrillPlans(): DrillPlanRow[] {
  return listRows(DRILL_PLAN_KEY) as DrillPlanRow[]
}

/** 启动/重置后的对账：补齐派生清单，不重复触发演练重排。 */
export function reconcileOnBoot(today: string = todayStr()): void {
  const hazards = listRows('hazard').map((row) => normalizeHazard(row, today))
  const todos = reconcileTodos(hazards, today)
  const assessments = reconcileAssessments(hazards)
  const hasPlan = (listRows(DRILL_PLAN_KEY) as DrillPlanRow[]).some((row) => Number(row.id) === ACTIVE_PLAN_ID)
  const patch: Record<string, EntryRow[]> = {
    [TODO_KEY]: todos,
    [ASSESSMENT_KEY]: assessments,
  }
  if (!hasPlan && assessments.length > 0) {
    const lastDate = assessments.map((row) => String(row['验收日期'])).sort().pop() ?? today
    patch[DRILL_PLAN_KEY] = arrangeDrill(hazards, lastDate, today)
  }
  savePatch(patch)
}

function commit(hazards: EntryRow[], triggerAccept: string | null, today: string): void {
  const todos = reconcileTodos(hazards, today)
  const assessments = reconcileAssessments(hazards)
  const patch: Record<string, EntryRow[]> = {
    hazard: hazards,
    [TODO_KEY]: todos,
    [ASSESSMENT_KEY]: assessments,
  }
  if (triggerAccept !== null) {
    patch[DRILL_PLAN_KEY] = arrangeDrill(hazards, triggerAccept, today)
  }
  savePatch(patch)
}

// ── 状态流转 ──

function stamp(ctx: ActionContext): string {
  return `${todayStr()} ${new Date().toTimeString().slice(0, 8)}`
}

export function dispatchHazard(id: number, ctx?: ActionContext): ActionResult {
  const denied = canWrite(ctx)
  if (denied) return denied
  const hazards = listRows('hazard')
  const index = hazards.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: '没有找到该隐患' }
  const row = normalizeHazard(hazards[index])
  const ownerDenied = assertOwner(row, ctx!)
  if (ownerDenied) return ownerDenied
  if (row.status !== '待整改') {
    return { ok: false, message: `隐患当前为「${row.status}」，不能重复派发` }
  }
  const logged = withLog(row, {
    time: stamp(ctx!),
    action: '派发整改',
    team: ctx!.team,
    operator: ctx!.operator,
    detail: `派发整改，期限 ${row['整改期限']}`,
  })
  const next = normalizeHazard({ ...logged, status: '整改中' })
  const list = [...hazards]
  list[index] = next
  commit(list, null, todayStr())
  return { ok: true, message: `已派发至${ctx!.team}，当前状态「整改中」` }
}

export type AcceptDecision = { pass: boolean; reason: string }

export function submitAcceptance(
  id: number,
  decision: AcceptDecision,
  ctx?: ActionContext,
  today: string = todayStr(),
): ActionResult {
  const denied = canWrite(ctx)
  if (denied) return denied
  const hazards = listRows('hazard')
  const index = hazards.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: '没有找到该隐患' }
  const row = normalizeHazard(hazards[index], today)
  const ownerDenied = assertOwner(row, ctx!)
  if (ownerDenied) return ownerDenied

  // 幂等：已验收隐患的重复提交一律不生效。
  if (row.status === HAZARD_ACCEPTED) {
    return {
      ok: false,
      message: `隐患 ${row['隐患编号']} 已于 ${row['验收日期']} 验收通过，重复提交只生效一次`,
    }
  }
  if (row.status === '待整改') {
    return { ok: false, message: '隐患尚未派发整改，不能提交验收' }
  }

  const time = stamp(ctx!)
  let next: EntryRow

  if (decision.pass) {
    // 验收通过：编号/部位/等级/期限与验收字段在这一个事务里一次性落库，逾期标记同步清除。
    const accepted = withLog(
      {
        ...row,
        status: HAZARD_ACCEPTED,
        验收日期: today,
        验收班组: ctx!.team,
        验收结论: '验收通过',
        验收次数: Number(row['验收次数'] ?? 0) + 1,
        验收说明: decision.reason || '现场复核合格',
      },
      { time, action: '验收通过', team: ctx!.team, operator: ctx!.operator, detail: decision.reason || '现场复核合格' },
    )
    next = normalizeHazard(accepted, today) // status=已验收 → pending=false、abnormal=false（逾期清除）
  } else {
    if (!decision.reason.trim()) {
      return { ok: false, message: '退回重改必须填写退回原因并留痕' }
    }
    // 退回重改：期限按该等级的整改周期，自「今天与原期限的较晚者」起顺延。
    const level = normalizeLevel(row['隐患等级'])
    const base = maxDateStr(today, String(row['整改期限'] ?? today))
    const extended = addDays(base, DEADLINE_DAYS_BY_LEVEL[level])
    const returned = withLog(
      {
        ...row,
        status: '整改中',
        退回次数: Number(row['退回次数'] ?? 0) + 1,
        整改期限: extended,
        最近退回原因: decision.reason.trim(),
      },
      {
        time,
        action: '退回重改',
        team: ctx!.team,
        operator: ctx!.operator,
        detail: decision.reason.trim(),
        deadlineBefore: String(row['整改期限'] ?? ''),
        deadlineAfter: extended,
      },
    )
    next = normalizeHazard(returned, today)
  }

  const list = [...hazards]
  list[index] = next
  commit(list, today, today)
  return {
    ok: true,
    message: decision.pass
      ? `验收通过，隐患 ${row['隐患编号']} 已闭环并清除逾期标记，评估清单与演练计划已同步`
      : `已退回重改，整改期限顺延至 ${next['整改期限']}，顺延记录已留痕`,
  }
}

/** 补录隐患：缺项一并补齐（期限按等级推定、归属当前班组），历史记录口径不受影响。 */
export function registerHazard(
  input: Partial<EntryRow>,
  ctx?: ActionContext,
  today: string = todayStr(),
): ActionResult & { id?: number } {
  const denied = canWrite(ctx)
  if (denied) return denied
  const site = String(input['隐患部位'] ?? '').trim()
  if (!site) return { ok: false, message: '补录失败：隐患部位为必填项' }

  const hazards = listRows('hazard')
  const year = today.slice(0, 4)
  const seqOfYear =
    hazards.filter((row) => String(row['隐患编号']).includes(`-${year}-`)).length + 1
  const id = Math.max(0, ...hazards.map((row) => Number(row.id))) + 1
  const level = normalizeLevel(input['隐患等级'])
  const found = String(input['发现日期'] ?? today) || today
  const deadlineGiven = String(input['整改期限'] ?? '').trim()
  const deadline = deadlineGiven || addDays(found, DEADLINE_DAYS_BY_LEVEL[level])
  const row: EntryRow = normalizeHazard(
    {
      id,
      status: '待整改',
      pending: true,
      abnormal: false,
      隐患编号: `HAZA-${year}-${String(seqOfYear).padStart(3, '0')}`,
      隐患部位: site,
      隐患等级: level,
      整改措施: String(input['整改措施'] ?? '').trim() || '待责任班组细化整改措施',
      责任班组: ctx!.team,
      责任人员: String(input['责任人员'] ?? ctx!.operator).trim() || ctx!.operator,
      发现日期: found,
      整改期限: deadline,
      整改状态: '待整改',
      数据来源: '补录',
    },
    today,
  )
  const list = [...hazards, row]
  commit(list, null, today)
  return { ok: true, message: `补录成功，缺项已按统一口径补齐，编号 ${row['隐患编号']}`, id }
}

// ── 导出：和列表同一份归一化数据，另附逾期列，字段缺失不会破坏 CSV ──

const HAZARD_EXPORT_COLUMNS = [
  '隐患编号',
  '隐患部位',
  '隐患等级',
  '整改措施',
  '责任班组',
  '责任人员',
  '发现日期',
  '整改期限',
  '验收日期',
  '验收结论',
  '退回次数',
  '回填备注',
]

export function exportHazards(today: string = todayStr()): { filename: string; content: string } {
  const header = [...HAZARD_EXPORT_COLUMNS, '当前状态', '是否逾期']
  const lines = [header.map(csvCell).join(',')]
  for (const row of hazardRows(today)) {
    const cells = HAZARD_EXPORT_COLUMNS.map((field) => row[field] ?? '')
    cells.push(String(row.status))
    cells.push(isOverdue(row, today) ? '逾期' : '正常')
    lines.push(cells.map(csvCell).join(','))
  }
  return { filename: '隐患整改管理-清单.csv', content: `﻿${lines.join('\n')}` }
}

/** 对账数字：概览/报表直接用它，保证报表与明细清单对得上。 */
export function hazardReconciliation(today: string = todayStr()) {
  const hazards = hazardRows(today)
  const todos = listRows(TODO_KEY) as TodoRow[]
  const open = hazards.filter((row) => row.status !== HAZARD_ACCEPTED)
  const openTodos = todos.filter((row) => row.pending)
  return {
    隐患总数: hazards.length,
    未验收隐患: open.length,
    待办总数: todos.length,
    待办待核销: openTodos.length,
    条数一致: open.length === openTodos.length,
    评估清单条数: (allRows()[ASSESSMENT_KEY] ?? []).length,
  }
}

const ASSESSMENT_COLUMNS = [
  '隐患编号',
  '隐患部位',
  '隐患等级',
  '验收结论',
  '验收日期',
  '验收班组',
  '退回原因',
  '同步时间',
]

/** 应急演练侧评估清单导出：内容与列表完全同源。 */
export function exportAssessments(): { filename: string; content: string } {
  const lines = [ASSESSMENT_COLUMNS.map(csvCell).join(',')]
  for (const row of listAssessments()) {
    lines.push(ASSESSMENT_COLUMNS.map((field) => csvCell(row[field] ?? '')).join(','))
  }
  return { filename: '应急演练-隐患验收评估清单.csv', content: `﻿${lines.join('\n')}` }
}

const PLAN_COLUMNS = ['计划编号', '演练场景', '关联隐患数', '涉及班组', '建议日期', '触发验收日期', '重排时间']

export function exportDrillPlans(): { filename: string; content: string } {
  const lines = [PLAN_COLUMNS.map(csvCell).join(',')]
  for (const row of listDrillPlans()) {
    lines.push(PLAN_COLUMNS.map((field) => csvCell(row[field] ?? '')).join(','))
  }
  return { filename: '应急演练-重排演练计划.csv', content: `﻿${lines.join('\n')}` }
}
