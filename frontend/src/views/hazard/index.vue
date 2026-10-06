<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患整改管理</h2>
        <p class="page-desc">隐患编号、部位、等级与整改期限随验收一次性落库；列表、概览、导出与整改待办读同一份，逾期为统一派生标记。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">补录隐患</button>
        <button class="btn" type="button" @click="exportRows">导出清单</button>
        <RouterLink class="btn ghost" to="/todo">整改待办（另一入口）</RouterLink>
      </div>
    </header>

    <p v-if="!isOwner" class="readonly-banner">
      当前班组「{{ store.team }}」对这些隐患为只读入口：不是本责任班组的提交一律按归属驳回。
      可切换到对应责任班组演示提交。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'tag-overdue': item.danger }">{{ item.value }}</strong>
      </article>
    </div>

    <details class="reconcile-box">
      <summary>
        报表对账：<span :class="reconcileReport.ok ? 'reconcile-ok' : 'reconcile-bad'">
          {{ reconcileReport.ok ? '四处口径全部一致' : '存在口径差异' }}
        </span>
        （列表 {{ counters.total }} · 待办 {{ todoTotal }} · 导出 {{ counters.total }} · 逾期 {{ counters.overdue }}）
      </summary>
      <ul>
        <li v-for="c in reconcileReport.checks" :key="c.name" :class="c.ok ? 'reconcile-ok' : 'reconcile-bad'">
          {{ c.ok ? '✓' : '✗' }} {{ c.name }}：{{ c.actual }} / 应为 {{ c.expected }}
        </li>
      </ul>
    </details>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '逾期'">
              <span v-if="row[column] === '逾期'" class="tag-overdue">逾期</span>
              <span v-else class="tag-ok">正常</span>
            </template>
            <template v-else-if="column === '整改状态'">
              <span :class="statusClass(String(row.status))">{{ row.status }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td class="row-actions">
            <button
              v-if="row.status === '待整改'"
              class="link" type="button"
              @click="dispatch(row)"
            >派发整改</button>
            <button
              v-if="row.status === '整改中' || row.status === '退回重改'"
              class="link" type="button"
              @click="openAccept(row)"
            >提交验收</button>
            <button class="link" type="button" @click="openAudit(row)">留痕</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无符合条件的隐患记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ counters.total }} 条隐患，整改待办 {{ todoTotal }} 条（1:1 同源投影），未结 {{ counters.pendingTodo }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="reconcile-ok">{{ okMessage }}</span>
    </footer>

    <!-- 验收弹窗 -->
    <ModalDialog :open="acceptOpen" :title="`提交验收 · ${acceptRow?.['隐患编号'] ?? ''}`" @close="acceptOpen = false">
      <p v-if="acceptRow" class="page-desc">
        {{ acceptRow['隐患部位'] }} ｜ {{ acceptRow['隐患等级'] }} ｜ 责任班组 {{ acceptRow['责任班组'] }} ｜ 整改期限 {{ acceptRow['整改期限'] }}
        <span v-if="acceptRow['逾期'] === '逾期'" class="tag-overdue">当前逾期</span>
      </p>
      <div class="form-grid">
        <label class="full">
          <span>验收结论 *（随验收一次性落库，并同步应急演练评估清单）</span>
          <textarea v-model="acceptForm.conclusion" rows="3" placeholder="如：复测合格 / 仍有渗漏点需返工"></textarea>
        </label>
        <label>
          <span>验收人员 *</span>
          <input v-model="acceptForm.acceptor" :placeholder="store.operator" />
        </label>
        <label>
          <span>提交班组（只读）</span>
          <input :value="store.team" disabled />
        </label>
      </div>
      <footer class="modal-foot">
        <button class="btn" type="button" @click="submitAccept(false)">退回重改（期限顺延并留痕）</button>
        <button class="btn primary" type="button" @click="submitAccept(true)">验收通过（清逾期+同步演练）</button>
      </footer>
    </ModalDialog>

    <!-- 补录弹窗 -->
    <ModalDialog :open="createOpen" title="补录隐患（缺项一并补齐）" @close="createOpen = false">
      <div class="form-grid">
        <label class="full">
          <span>隐患部位 *</span>
          <input v-model="createForm.part" placeholder="如：北环综合舱 K1+300 顶板" />
        </label>
        <label>
          <span>隐患等级 *</span>
          <select v-model="createForm.level">
            <option value="" disabled>请选择</option>
            <option v-for="lv in levels" :key="lv" :value="lv">{{ lv }}（限期 {{ sla[lv] }} 天）</option>
          </select>
        </label>
        <label>
          <span>责任班组 *</span>
          <select v-model="createForm.team">
            <option v-for="t in store.teams" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label>
          <span>责任人员 *</span>
          <input v-model="createForm.owner" />
        </label>
        <label>
          <span>发现日期 *</span>
          <input v-model="createForm.findDate" type="date" />
        </label>
        <label>
          <span>整改期限（留空按发现日期+等级推定）</span>
          <input v-model="createForm.deadline" type="date" />
        </label>
        <label class="full">
          <span>整改措施 *</span>
          <textarea v-model="createForm.measure" rows="2"></textarea>
        </label>
      </div>
      <p class="page-desc">历史记录仍按原口径保留；补录缺项的由系统按等级 SLA 推定并留痕。</p>
      <footer class="modal-foot">
        <button class="btn primary" type="button" @click="submitCreate">提交补录</button>
      </footer>
    </ModalDialog>

    <AuditDrawer :open="auditOpen" :code="auditCode" :entries="auditEntries" @close="auditOpen = false" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { downloadBlob } from '@/api/local-service'
import {
  acceptHazard,
  createHazard,
  dispatchHazard,
  exportHazards,
  hazardAudit,
  hazardCounters,
  hazardReconcile,
  listHazards,
} from '@/api/hazard-service'
import { HAZARD_LEVELS, LEVEL_SLA_DAYS, ownsHazard } from '@/data/hazard-policy'
import type { AuditEntry, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import ModalDialog from '@/components/ModalDialog.vue'
import AuditDrawer from '@/components/AuditDrawer.vue'

const store = useSessionStore()
const route = useRoute()
const columns = [
  '隐患编号', '隐患部位', '隐患等级', '整改措施', '责任人员', '责任班组',
  '发现日期', '整改期限', '逾期', '验收日期', '验收人员', '验收结论', '整改状态',
]
const filterFields = ['隐患编号', '隐患部位', '隐患等级', '责任班组']
const levels = [...HAZARD_LEVELS]
const sla = LEVEL_SLA_DAYS

const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const okMessage = ref('')

const counters = ref(hazardCounters())
const todoTotal = computed(() => counters.value.total)
const reconcileReport = ref(hazardReconcile())
const allHazards = ref<EntryRow[]>([])
const isOwner = computed(() => allHazards.value.some((r) => ownsHazard(r, store.team)))

function reload() {
  errorMessage.value = ''
  allHazards.value = listHazards({})
  const focus = route.query.focus
  if (typeof focus === 'string' && focus && !Object.values(filters.value).some(Boolean)) {
    filters.value = { 隐患编号: focus }
  }
  rows.value = listHazards(filters.value)
  counters.value = hazardCounters()
  reconcileReport.value = hazardReconcile()
}

const stats = computed(() => [
  { label: '待整改隐患', value: counters.value.waiting, danger: false },
  { label: '整改中隐患', value: counters.value.rectifying, danger: false },
  { label: '退回重改', value: counters.value.returned, danger: true },
  { label: '已验收隐患', value: counters.value.accepted, danger: false },
  { label: '逾期隐患（派生）', value: counters.value.overdue, danger: counters.value.overdue > 0 },
])

function statusClass(status: string) {
  if (status === '已验收') return 'tag-ok'
  if (status === '退回重改') return 'tag-return'
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportHazards(filters.value)
  downloadBlob(filename, content)
  okMessage.value = `导出 ${rows.value.length} 条，与当前列表、对账口径完全一致`
}

function flash(result: { ok: boolean; message: string }) {
  if (result.ok) {
    okMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    okMessage.value = ''
  }
  reload()
}

function dispatch(row: EntryRow) {
  flash(dispatchHazard(Number(row.id), store.team, store.operator))
}

// ── 验收 ──
const acceptOpen = ref(false)
const acceptRow = ref<EntryRow | null>(null)
const acceptForm = ref({ conclusion: '', acceptor: '' })

function openAccept(row: EntryRow) {
  acceptRow.value = row
  acceptForm.value = { conclusion: '', acceptor: store.operator }
  acceptOpen.value = true
}

function submitAccept(passed: boolean) {
  if (!acceptRow.value) return
  const result = acceptHazard(
    Number(acceptRow.value.id),
    { passed, conclusion: acceptForm.value.conclusion, acceptor: acceptForm.value.acceptor },
    store.team,
    store.operator,
  )
  flash(result)
  if (result.ok) acceptOpen.value = false
}

// ── 补录 ──
const createOpen = ref(false)
const emptyDraft = () => ({
  part: '', level: '', measure: '', owner: '', team: store.team, findDate: '', deadline: '',
})
const createForm = ref(emptyDraft())

function openCreate() {
  createForm.value = emptyDraft()
  createOpen.value = true
}

function submitCreate() {
  const result = createHazard({ ...createForm.value }, store.operator)
  flash(result)
  if (result.ok) createOpen.value = false
}

// ── 留痕 ──
const auditOpen = ref(false)
const auditCode = ref('')
const auditEntries = ref<AuditEntry[]>([])

function openAudit(row: EntryRow) {
  auditCode.value = String(row['隐患编号'])
  auditEntries.value = hazardAudit(Number(row.id))
  auditOpen.value = true
}

onMounted(reload)
</script>
