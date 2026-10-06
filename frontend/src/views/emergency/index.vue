<template>
  <section class="page" data-module="emergency">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">隐患验收结论同步到本页评估清单；同一隐患只维护一条，重验更新、已评估的按最新隐患情况再排一次演练。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">待组织演练</span><strong>{{ c.waiting }}</strong></article>
      <article class="stat-card"><span class="stat-label">演练中</span><strong>{{ c.doing }}</strong></article>
      <article class="stat-card"><span class="stat-label">已评估</span><strong>{{ c.done }}</strong></article>
      <article class="stat-card"><span class="stat-label">关联隐患条目</span><strong>{{ c.linked }}</strong></article>
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
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="sub-title">演练评估清单（含隐患验收同步）</h3>
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
            <button class="link" type="button" @click="runAction('组织演练', row)">组织演练</button>
            <button class="link" type="button" @click="runAction('提交评估', row)">提交评估</button>
            <button class="link" type="button" @click="runAction('取消演练', row)">取消演练</button>
            <button
              v-if="row['关联隐患编号']"
              class="link" type="button"
              @click="runAction('按隐患重排', row)"
            >按最新隐患重排</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据</td>
        </tr>
      </tbody>
    </table>

    <h3 class="sub-title">最新隐患情况（验收/退回口径，演练排期依据）</h3>
    <table class="data-table">
      <thead>
        <tr><th>隐患编号</th><th>部位</th><th>等级</th><th>状态</th><th>验收日期</th><th>验收结论/退回意见</th></tr>
      </thead>
      <tbody>
        <tr v-for="h in hazards" :key="String(h.id)">
          <td>{{ h['隐患编号'] }}</td>
          <td>{{ h['隐患部位'] }}</td>
          <td>{{ h['隐患等级'] }}</td>
          <td>
            <span :class="h.status === '退回重改' ? 'tag-return' : 'tag-ok'">{{ h.status }}</span>
          </td>
          <td>{{ h['验收日期'] ?? '—' }}</td>
          <td>{{ h.status === '已验收' ? h['验收结论'] : `退回重改：${h['最近退回结论'] ?? ''}（期限顺延至${h['整改期限']}）` }}</td>
        </tr>
        <tr v-if="!hazards.length">
          <td colspan="6" class="empty-state">暂无可供排期的验收/退回隐患</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条演练记录；评估清单与隐患验收结论为同一同步链路</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="reconcile-ok">{{ okMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { latestHazardsForEmergency } from '@/api/hazard-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('emergency')
const columns = ['演练编号', '演练场景', '参与班组', '计划日期', '演练时长', '评估结论', '关联隐患编号', '隐患快照', '同步时间']
const filterFields = ['演练编号', '演练场景', '参与班组', '关联隐患编号']

const rows = ref<EntryRow[]>([])
const hazards = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  ['待组织', '演练中', '已评估', '已取消'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const c = computed(() => ({
  waiting: rows.value.filter((r) => r.status === '待组织').length,
  doing: rows.value.filter((r) => r.status === '演练中').length,
  done: rows.value.filter((r) => r.status === '已评估').length,
  linked: rows.value.filter((r) => r['关联隐患编号']).length,
}))

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
  hazards.value = latestHazardsForEmergency()
}

onMounted(reload)
</script>

<style scoped>
.sub-title { font-size: 14px; margin: 18px 0 8px; }
</style>
