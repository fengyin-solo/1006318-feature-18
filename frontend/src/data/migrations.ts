import { addAudit } from './audit-store'
import {
  DEFAULT_TEAM,
  addDays,
  deriveHazard,
  formatDate,
  inferDeadline,
  isMissing,
  normalizeLevel,
  parseDate,
  projectHazard,
} from './hazard-policy'
import { BACKFILL_FIELDS, editionForYear, latestEdition } from './history-editions'
import type { EntryRow } from './types'

/**
 * 版本化迁移：幂等、可重放。升级老用户 localStorage 与重置模块都走这里。
 *  v1 存量隐患：以发现日期为轴回填等级/整改期限/责任班组，口径统一到派生状态机；
 *  v2 历史单据：渗漏水处置单/检修记录以完工日期为轴，按当年版本补齐残缺取值；
 *  v3 演练初排：存量已验收隐患的验收结论同步进应急演练评估清单。
 */
export const MIGRATION_VERSION = 3

type Migration = {
  version: number
  key: string
  apply: (data: Record<string, EntryRow[]>, reason: string) => void
}

function axisYear(row: EntryRow, axisFields: string[]): { year: number | null; axisField: string | null } {
  for (const f of axisFields) {
    const d = parseDate(row[f])
    if (d) return { year: d.getFullYear(), axisField: f }
  }
  return { year: null, axisField: null }
}

const migrations: Migration[] = [
  {
    version: 1,
    key: '存量隐患回填',
    apply(data, reason) {
      const rows = data.hazard
      if (!rows) return
      rows.forEach((row, i) => {
        const already = String(row['回填批次'] ?? '')
        if (already.includes('v1')) return
        const code = String(row['隐患编号'] ?? `hazard#${i + 1}`)
        const fills: string[] = []

        // 等级：残缺按"一般"推定
        const { level, assumed } = normalizeLevel(row['隐患等级'])
        if (assumed || isMissing(row['隐患等级'])) {
          fills.push(`隐患等级「${row['隐患等级'] ?? ''}」残缺→按一般推定`)
          row['隐患等级'] = level
        }

        // 整改期限：以发现日期为轴 + 等级 SLA
        if (isMissing(row['整改期限']) || parseDate(row['整改期限']) === null) {
          const deadline = inferDeadline(row['发现日期'], level)
          fills.push(`整改期限缺失→以发现日期${String(row['发现日期'] ?? '')}为轴按${level}隐患推定至${deadline}`)
          row['整改期限'] = deadline
        }

        // 责任班组：旧数据没有归属，补默认班组（权限模型需要）
        if (isMissing(row['责任班组'])) {
          fills.push(`责任班组缺失→补默认班组${DEFAULT_TEAM}`)
          row['责任班组'] = DEFAULT_TEAM
        }

        // 状态机收口：历史"已逾期"不是状态，逾期由期限重新派生
        const d = deriveHazard(row)
        row['status'] = d.status
        const projected = projectHazard(row)
        row['pending'] = projected.pending
        row['abnormal'] = projected.abnormal
        row['整改状态'] = d.status
        row['逾期'] = d.overdue ? '逾期' : '正常'

        row['回填批次'] = `v1-${reason}`
        if (fills.length > 0) {
          addAudit({
            module: 'hazard',
            refCode: code,
            action: '存量回填',
            operator: '系统迁移',
            batch: `存量回填v1/${reason}`,
            detail: fills.join('；'),
          })
        }
      })
    },
  },
  {
    version: 2,
    key: '历史单据按年版补齐',
    apply(data, reason) {
      const targets: { module: string; axisFields: string[] }[] = [
        { module: 'leak', axisFields: ['完工日期', '发现日期'] },
        { module: 'maintenance', axisFields: ['完工日期', '计划工期'] },
      ]
      for (const t of targets) {
        const rows = data[t.module]
        if (!rows) continue
        rows.forEach((row, i) => {
          const already = String(row['回填批次'] ?? '')
          if (already.includes('v2')) return
          const code = String(row[Object.keys(row).find((k) => k.endsWith('编号')) ?? 'id'] ?? `${t.module}#${i + 1}`)
          const { year, axisField } = axisYear(row, t.axisFields)
          const rule = year === null ? latestEdition() : editionForYear(year)
          const fills: string[] = []
          for (const field of BACKFILL_FIELDS[t.module]) {
            if (isMissing(row[field])) {
              const fallback = rule.defaults[t.module][field] ?? `待补录（${rule.edition}）`
              fills.push(`${field}残缺→按${rule.label}补「${fallback}」`)
              row[field] = fallback
            }
          }
          const axisNote =
            year === null
              ? '无完工日期且回退轴也缺失，按最新版补齐并标注轴缺失'
              : `以${axisField}${year}年为轴取${rule.edition}`
          row['回填批次'] = `v2-${reason}`
          row['回填依据'] = year === null ? `${rule.label}；轴缺失` : rule.label
          // 状态字段原口径保留，不在此重算。
          if (fills.length > 0) {
            addAudit({
              module: t.module,
              refCode: code,
              action: '历史单据回填',
              operator: '系统迁移',
              batch: `历史回填v2/${reason}`,
              detail: `${axisNote}；依据：${rule.basis}；${fills.join('；')}`,
            })
          }
        })
      }
    },
  },
  {
    version: 3,
    key: '验收结论同步演练初排',
    apply(data, reason) {
      const hazards = data.hazard
      const drills = data.emergency
      if (!hazards || !drills) return
      let nextId = drills.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)
      for (const h of hazards) {
        const d = deriveHazard(h)
        if (d.status !== '已验收') continue
        const code = String(h['隐患编号'] ?? '')
        if (!code) continue
        const linked = drills.find((r) => String(r['关联隐患编号'] ?? '') === code)
        const acceptedAt = String(h['验收日期'] ?? '')
        const level = String(h['隐患等级'] ?? '')
        const part = String(h['隐患部位'] ?? '')
        const team = String(h['责任班组'] ?? DEFAULT_TEAM)
        const conclusion = String(h['验收结论'] ?? '历史验收通过（验收单信息缺失）')
        const snapshot = `[${level}] ${part}（${code}）${acceptedAt} 验收通过`
        if (linked) {
          linked['评估结论'] = conclusion
          linked['隐患快照'] = snapshot
          linked['同步时间'] = new Date().toISOString()
          continue
        }
        nextId += 1
        const planBase = parseDate(acceptedAt) ?? new Date()
        drills.push({
          id: nextId,
          status: '待组织',
          pending: true,
          abnormal: false,
          演练编号: `EMER-AUTO-${String(nextId).padStart(4, '0')}`,
          演练场景: `隐患整改复核：${part}`,
          参与班组: team,
          计划日期: formatDate(addDays(planBase, 3)),
          演练时长: '2小时',
          评估结论: conclusion,
          组织人员: '值班管理员',
          演练状态: '待组织',
          关联隐患编号: code,
          隐患快照: snapshot,
          同步时间: new Date().toISOString(),
          同步来源: `v3-${reason}`,
        })
        addAudit({
          module: 'emergency',
          refCode: code,
          action: '验收结论同步初排',
          operator: '系统迁移',
          batch: `演练初排v3/${reason}`,
          detail: `存量已验收隐患 ${snapshot}，按最新隐患情况排入待组织演练`,
        })
      }
    },
  },
]

export function runMigrations(
  data: Record<string, EntryRow[]>,
  fromVersion: number,
  reason: string,
): { data: Record<string, EntryRow[]>; ran: number[] } {
  const ran: number[] = []
  for (const m of migrations) {
    if (fromVersion < m.version) {
      m.apply(data, reason)
      ran.push(m.version)
    }
  }
  return { data, ran }
}
