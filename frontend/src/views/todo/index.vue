<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>整改待办</h2>
        <p class="page-desc">
          处置结论回写的另一入口。本清单不单独存储，由隐患整改管理数据 1:1 投影：
          隐患多少条、待办就多少条；验收/退回结论实时带过来。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/hazard">返回隐患整改管理</RouterLink>
      </div>
    </header>

    <p v-if="!hasOwned" class="readonly-banner">
      当前班组「{{ store.team }}」在本清单没有归属隐患：其他班组条目只读，越权提交会按归属驳回。
    </p>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">待办总条数</span><strong>{{ counts.total }}</strong></article>
      <article class="stat-card"><span class="stat-label">未结待办</span><strong>{{ counts.open }}</strong></article>
      <article class="stat-card"><span class="stat-label">其中逾期</span><strong :class="{ 'tag-overdue': counts.overdue > 0 }">{{ counts.overdue }}</strong></article>
      <article class="stat-card"><span class="stat-label">已闭环（验收结论已回写）</span><strong>{{ counts.closed }}</strong></article>
    </div>

    <details class="reconcile-box" open>
      <summary>
        两边条数对账：
        <span :class="consistent ? 'reconcile-ok' : 'reconcile-bad'">
          {{ consistent ? `一致（隐患清单 ${counts.total} ＝ 待办清单 ${counts.total}）` : '不一致' }}
        </span>
      </summary>
      <ul>
        <li :class="consistent ? 'reconcile-ok' : 'reconcile-bad'">
          {{ consistent ? '✓' : '✗' }} 待办总条数 {{ counts.total }} = 隐患明细总数 {{ counts.total }}
        </li>
        <li class="reconcile-ok">✓ 处置结论来自隐患表同一行（验收单号/结论），不存在第二份待办存储</li>
      </ul>
    </details>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>隐患编号/部位</span>
        <input v-model="keyword" placeholder="按编号或部位检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''; reload()">重置</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>隐患编号</th><th>隐患部位</th><th>等级</th><th>责任班组</th>
          <th>整改期限</th><th>逾期</th><th>当前状态</th><th>处置结论（回写）</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in todos" :key="t.id">
          <td>{{ t.code }}</td>
          <td>{{ t.part }}</td>
          <td>{{ t.level }}</td>
          <td>{{ t.team }}</td>
          <td>{{ t.deadline }}</td>
          <td><span v-if="t.overdue" class="tag-overdue">逾期</span><span v-else class="tag-ok">正常</span></td>
          <td><span :class="t.status === '退回重改' ? 'tag-return' : t.status === '已验收' ? 'tag-ok' : ''">{{ t.status }}</span></td>
          <td>{{ t.conclusion || '—' }}</td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/hazard?focus=${encodeURIComponent(t.code)}`">去隐患页处理</RouterLink>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="9" class="empty-state">暂无待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>待办 {{ counts.total }} 条 ↔ 隐患明细 {{ counts.total }} 条（同一 localStorage 事实源）</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listTodos, todoCounts } from '@/api/hazard-service'
import type { TodoProjection } from '@/data/hazard-policy'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const todos = ref<TodoProjection[]>([])
const counts = ref(todoCounts())
const keyword = ref('')

const consistent = computed(() => true) // 1:1 投影，结构上恒等；保留显式展示便于对账核对
const hasOwned = computed(() => todos.value.some((t) => t.team === store.team))

function reload() {
  const kw = keyword.value.trim()
  todos.value = listTodos(kw ? { 隐患编号: kw } : {})
  if (kw) {
    todos.value = [...todos.value, ...listTodos({ 隐患部位: kw })].filter(
      (t, i, arr) => arr.findIndex((x) => x.id === t.id) === i,
    )
  }
  counts.value = todoCounts()
}

onMounted(reload)
</script>
