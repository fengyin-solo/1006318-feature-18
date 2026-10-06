import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { filterRows, projectHazard } from '@/data/hazard-policy'
import { replanFromHazard } from './hazard-service'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export { filterRows }

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  let rows = listRows(key)
  if (key === 'hazard') {
    // 隐患模块所有读取都过统一派生口径，概览/导出/待办与列表同源。
    rows = rows.map((r) => projectHazard(r))
  }
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 通用状态流转。隐患模块的动作（派发/验收/退回）不走这里，
 * 统一由 hazard-service 处理（落库字段、逾期清理、顺延留痕、演练同步是一个事务）。
 */
export function runAction(key: string, id: number, action: string, operator = '值班管理员'): ActionResult {
  if (key === 'hazard') {
    return { ok: false, message: '隐患整改动作请走隐患整改入口的专用提交' }
  }
  const meta = moduleMeta(key)

  // 应急演练的"按隐患重排"：按关联隐患编号取最新结论重排一次。
  if (key === 'emergency' && action === '按隐患重排') {
    const row = listRows(key).find((r) => Number(r.id) === id)
    if (!row) return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    const code = String(row['关联隐患编号'] ?? '')
    if (!code) return { ok: false, message: '该演练未关联隐患，无法按隐患重排' }
    return replanFromHazard(code, operator)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === 'emergency') {
    updated['演练状态'] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = meta.fields
  const lines = [header.join(',')]
  let rows = listRows(key)
  if (key === 'hazard') rows = rows.map((r) => projectHazard(r))
  for (const row of rows) {
    lines.push(header.map((field) => csvCell(row[field])).join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `${String.fromCharCode(0xfeff)}${lines.join('\n')}` }
}

export function downloadBlob(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadBlob(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  let overdueHazards = 0
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    let entries = rows[meta.key] ?? []
    if (meta.key === 'hazard') {
      // 概览与列表同一口径：隐患的 pending/abnormal/逾期由统一派生重算后落库。
      const projected = entries.map((r) => projectHazard(r))
      const drifted = projected.some(
        (p, i) =>
          p.pending !== entries[i].pending ||
          p.abnormal !== entries[i].abnormal ||
          p.status !== entries[i].status,
      )
      if (drifted) saveRows('hazard', projected)
      entries = projected
      overdueHazards = projected.filter((r) => String(r['逾期']) === '逾期').length
    }
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules, overdueHazards }
}
