<template>
  <section class="page" data-module="emergency">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">
          隐患验收结论同步到评估清单，演练侧按最新隐患情况自动重排一次演练（旧计划留痕）。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出演练清单</button>
        <button class="btn" type="button" @click="exportAssessmentRows">导出评估清单</button>
        <button class="btn" type="button" @click="exportPlanRows">导出演练计划</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="block-title">重排演练计划（按最新隐患情况）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in planColumns" :key="column">{{ column }}</th>
          <th>计划状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plan in plans" :key="String(plan.id)">
          <td v-for="column in planColumns" :key="column">{{ plan[column] ?? '—' }}</td>
          <td>
            <span v-if="plan.status === '待组织'" class="pending-tag">{{ plan.status }}</span>
            <span v-else class="muted-text">{{ plan.status }}</span>
          </td>
        </tr>
        <tr v-if="!plans.length">
          <td :colspan="planColumns.length + 1" class="empty-state">隐患验收后自动生成演练计划</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">隐患验收评估清单（与隐患整改验收同源同步）</h3>
    <p class="page-desc">共 {{ assessments.length }} 条验收结论；同一隐患重复提交验收只保留一条生效结论。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in assessmentColumns" :key="column">{{ column }}</th>
          <th>处置状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in assessments" :key="`${item['隐患id']}-${item['验收序号']}`">
          <td v-for="column in assessmentColumns" :key="column">{{ item[column] || '—' }}</td>
          <td>
            <span :class="item['验收结论'] === '退回重改' ? 'return-tag' : 'pass-tag'">
              {{ item['验收结论'] }}
            </span>
          </td>
        </tr>
        <tr v-if="!assessments.length">
          <td :colspan="assessmentColumns.length + 1" class="empty-state">暂无验收结论同步</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">演练台账</h3>
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
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条演练台账记录</span>
      <span class="muted-text">评估清单 {{ assessments.length }} 条，与隐患验收结论逐条对应</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  exportAssessments,
  exportDrillPlans,
  listAssessments,
  listDrillPlans,
} from '@/api/hazard-service'
import { downloadCsv } from '@/api/download'
import type { AssessmentRow, DrillPlanRow, EntryRow } from '@/data/types'

const meta = moduleMeta('emergency')
const columns = ["演练编号", "演练场景", "参与班组", "计划日期", "演练时长", "评估结论", "组织人员", "演练状态"]
const actions = ["组织演练", "提交评估", "取消演练"]
const statuses = ["待组织", "演练中", "已评估", "已取消"]
const stats = ref([
  { label: '待组织演练', value: 0 },
  { label: '已评估演练', value: 0 },
  { label: '本月演练次数', value: 0 },
])

const assessmentColumns = ["隐患编号", "隐患部位", "隐患等级", "验收结论", "验收日期", "验收班组", "退回原因", "同步时间"]
const planColumns = ["计划编号", "演练场景", "关联隐患数", "涉及班组", "建议日期", "触发验收日期", "重排时间"]

const rows = ref<EntryRow[]>([])
const assessments = ref<AssessmentRow[]>([])
const plans = ref<DrillPlanRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  for (const key of Object.keys(filters)) delete filters[key]
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function exportAssessmentRows() {
  downloadCsv(exportAssessments())
}

function exportPlanRows() {
  downloadCsv(exportDrillPlans())
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: '待组织演练', value: rows.value.filter((r) => r.status === '待组织').length },
      { label: '已评估演练', value: rows.value.filter((r) => r.status === '已评估').length },
      { label: '本月演练次数', value: rows.value.filter((r) => r.status === '已评估').length },
    ]
    assessments.value = listAssessments()
    plans.value = [...listDrillPlans()].reverse()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练数据读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.block-title { font-size: 15px; margin: 18px 0 8px; }
.muted-text { color: var(--muted); font-size: 12px; }
.pending-tag { background: #fef0c7; color: #b54708; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.pass-tag { color: #027a48; background: #d1fadf; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.return-tag { color: #b42318; background: #fee4e2; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
</style>
