<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患整改管理</h2>
        <p class="page-desc">
          隐患编号、部位、等级与整改期限验收时一次性落库；列表、概览、导出同读一份。
          当前责任班组：<strong>{{ store.team }}</strong>
          <span v-if="store.isReadonly" class="readonly-tag">只读入口</span>
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="store.isReadonly" @click="openCreate">补录隐患</button>
        <button class="btn" type="button" @click="exportRows">导出隐患清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>整改状态</span>
        <select v-model="filters['整改状态']">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>逾期</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '隐患编号'">
              <button class="link" type="button" @click="openTrail(row)">{{ row[column] }}</button>
            </template>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>
            <span v-if="isOverdueRow(row)" class="overdue-tag">逾期</span>
            <span v-else class="ok-text">正常</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="row.status === '待整改' && canWriteRow(row)"
              class="link"
              type="button"
              @click="dispatch(row)"
            >派发整改</button>
            <template v-if="row.status === '整改中' && canWriteRow(row)">
              <button class="link" type="button" @click="openAccept(row, true)">提交验收</button>
              <button class="link danger" type="button" @click="openAccept(row, false)">退回重改</button>
            </template>
            <span v-if="!canWriteRow(row)" class="muted-text">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的隐患，可先补录一条</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患记录（与导出清单同源）</span>
      <span :class="recon.条数一致 ? 'ok-text' : 'error-text'">
        口径核对：未验收隐患 {{ recon.未验收隐患 }} ＝ 整改待办 {{ recon.待办待核销 }}；逾期 {{ statOverdue }}
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 验收对话框：通过 / 退回重改 共用，退回必须填原因 -->
    <div v-if="acceptTarget" class="modal-mask" @click.self="acceptTarget = null">
      <div class="modal">
        <h3>{{ acceptPass ? '提交验收' : '退回重改' }} · {{ acceptTarget['隐患编号'] }}</h3>
        <p class="modal-line">隐患部位：{{ acceptTarget['隐患部位'] }}　等级：{{ acceptTarget['隐患等级'] }}</p>
        <p class="modal-line">当前整改期限：{{ acceptTarget['整改期限'] }}
          <span v-if="acceptPass" class="muted-text">（验收通过后逾期标记即时清除）</span>
          <span v-else class="muted-text">（退回后期限按等级周期顺延，顺延记录留痕）</span>
        </p>
        <label class="filter-item">
          <span>{{ acceptPass ? '验收说明（可空）' : '退回原因（必填）' }}</span>
          <textarea v-model="acceptReason" rows="3" :placeholder="acceptPass ? '现场复核合格' : '说明不达标项，随退回留痕'"></textarea>
        </label>
        <p v-if="acceptError" class="error-text">{{ acceptError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="acceptTarget = null">取消</button>
          <button class="btn primary" type="button" @click="confirmAccept">
            确认{{ acceptPass ? '验收通过' : '退回重改' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 补录对话框：缺项由服务层按统一口径补齐 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal">
        <h3>补录隐患</h3>
        <p class="modal-line muted-text">隐患编号自动生成；未填整改期限按等级推定（重大7/较大15/一般30/低60天），归属当前班组。</p>
        <div class="form-grid">
          <label class="filter-item"><span>隐患部位 *</span><input v-model="createForm['隐患部位']" /></label>
          <label class="filter-item">
            <span>隐患等级</span>
            <select v-model="createForm['隐患等级']">
              <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="filter-item"><span>发现日期</span><input v-model="createForm['发现日期']" type="date" /></label>
          <label class="filter-item"><span>整改期限（留空按等级推定）</span><input v-model="createForm['整改期限']" type="date" /></label>
          <label class="filter-item"><span>责任人员</span><input v-model="createForm['责任人员']" /></label>
          <label class="filter-item span2"><span>整改措施</span><input v-model="createForm['整改措施']" /></label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="confirmCreate">提交补录</button>
        </div>
      </div>
    </div>

    <!-- 流转留痕 -->
    <div v-if="trailTarget" class="modal-mask" @click.self="trailTarget = null">
      <div class="modal">
        <h3>流转留痕 · {{ trailTarget['隐患编号'] }}</h3>
        <p class="modal-line" v-if="Number(trailTarget['退回次数'] ?? 0) > 0">
          退回次数：{{ trailTarget['退回次数'] }}　最近原因：{{ trailTarget['最近退回原因'] }}
        </p>
        <table class="data-table">
          <thead><tr><th>时间</th><th>动作</th><th>班组/操作人</th><th>说明</th><th>期限变化</th></tr></thead>
          <tbody>
            <tr v-for="(log, i) in trailLogs" :key="i">
              <td>{{ log.time }}</td>
              <td>{{ log.action }}</td>
              <td>{{ log.team }} / {{ log.operator }}</td>
              <td>{{ log.detail }}</td>
              <td v-if="log.deadlineAfter">{{ log.deadlineBefore || '—' }} → {{ log.deadlineAfter }}</td>
              <td v-else>—</td>
            </tr>
            <tr v-if="!trailLogs.length"><td colspan="5" class="empty-state">暂无流转记录</td></tr>
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="trailTarget = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  dispatchHazard,
  exportHazards,
  hazardRows,
  hazardSummary,
  hazardTrail,
  hazardReconciliation,
  listHazards,
  registerHazard,
  submitAcceptance,
} from '@/api/hazard-service'
import { downloadCsv } from '@/api/download'
import { isOverdue } from '@/data/domain'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const columns = ["隐患编号", "隐患部位", "隐患等级", "整改措施", "责任班组", "责任人员", "发现日期", "整改期限", "验收日期", "验收结论", "退回次数"]
const filterFields = ["隐患编号", "隐患部位", "责任班组"]
const statuses = ["待整改", "整改中", "已验收"]
const levels = ["重大", "较大", "一般", "低"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})

const summary = ref(hazardSummary())
const recon = ref(hazardReconciliation())
const statOverdue = computed(() => summary.value.overdue)
const statCards = computed(() => [
  { label: '待整改隐患', value: summary.value.pendingRectify, warn: false },
  { label: '整改中隐患', value: summary.value.rectifying, warn: false },
  { label: '已验收隐患', value: summary.value.accepted, warn: false },
  { label: '逾期隐患', value: summary.value.overdue, warn: summary.value.overdue > 0 },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOverdueRow(row: EntryRow): boolean {
  return isOverdue(row)
}

function canWriteRow(row: EntryRow): boolean {
  return !store.isReadonly && row['责任班组'] === store.team
}

function resetFilters() {
  for (const key of Object.keys(filters)) delete filters[key]
  reload()
}

function exportRows() {
  downloadCsv(exportHazards())
}

function refreshMeta() {
  summary.value = hazardSummary()
  recon.value = hazardReconciliation()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listHazards(filters)
    rows.value = payload.items
    total.value = payload.total
    refreshMeta()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患列表读取失败'
  }
}

function fail(message: string) {
  errorMessage.value = message
}

function dispatch(row: EntryRow) {
  const result = dispatchHazard(Number(row.id), { team: store.team, operator: store.operator })
  if (!result.ok) return fail(result.message)
  errorMessage.value = ''
  reload()
}

// 验收对话框
const acceptTarget = ref<EntryRow | null>(null)
const acceptPass = ref(true)
const acceptReason = ref('')
const acceptError = ref('')

function openAccept(row: EntryRow, pass: boolean) {
  acceptTarget.value = row
  acceptPass.value = pass
  acceptReason.value = ''
  acceptError.value = ''
}

function confirmAccept() {
  if (!acceptTarget.value) return
  const result = submitAcceptance(
    Number(acceptTarget.value.id),
    { pass: acceptPass.value, reason: acceptReason.value },
    { team: store.team, operator: store.operator },
  )
  if (!result.ok) {
    acceptError.value = result.message
    return
  }
  acceptTarget.value = null
  errorMessage.value = ''
  reload()
}

// 补录
const creating = ref(false)
const createError = ref('')
const createForm = reactive<Record<string, string>>({
  隐患部位: '',
  隐患等级: '一般',
  发现日期: '',
  整改期限: '',
  责任人员: '',
  整改措施: '',
})

function openCreate() {
  creating.value = true
  createError.value = ''
}

function confirmCreate() {
  const result = registerHazard({ ...createForm }, { team: store.team, operator: store.operator })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  for (const key of Object.keys(createForm)) createForm[key] = ''
  createForm['隐患等级'] = '一般'
  errorMessage.value = ''
  reload()
}

// 留痕
const trailTarget = ref<EntryRow | null>(null)
const trailLogs = ref<ReturnType<typeof hazardTrail>>([])

function openTrail(row: EntryRow) {
  trailTarget.value = row
  trailLogs.value = hazardTrail(row)
}

onMounted(() => {
  // 全量归一化一次，保证当前页逾期标记随今天滚动
  rows.value = hazardRows()
  reload()
})
</script>

<style scoped>
.warn { color: #b42318; }
.overdue-tag { color: #b42318; background: #fee4e2; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.ok-text { color: #027a48; }
.muted-text { color: var(--muted); font-size: 12px; }
.readonly-tag { margin-left: 6px; background: #eef2f7; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.danger { color: #b42318; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 640px; max-width: 92vw; max-height: 86vh; overflow: auto; }
.modal h3 { margin: 0 0 10px; }
.modal-line { font-size: 13px; margin: 4px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-grid .span2 { grid-column: span 2; }
textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
</style>
