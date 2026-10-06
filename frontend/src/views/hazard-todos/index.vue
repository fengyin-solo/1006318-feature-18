<template>
  <section class="page" data-module="hazard-todos">
    <header class="page-head">
      <div>
        <h2>整改待办清单</h2>
        <p class="page-desc">
          另一个入口的待办：每条未验收隐患自动回写一条待办，验收通过即核销。
          本入口只读，请到「隐患整改管理」按责任班组提交处置。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待办总数</span>
        <strong class="stat-value">{{ todos.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待核销</span>
        <strong class="stat-value" :class="{ warn: recon.条数一致 === false }">{{ recon.待办待核销 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已核销（验收通过）</span>
        <strong class="stat-value ok">{{ closedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未验收隐患（隐患侧）</span>
        <strong class="stat-value">{{ recon.未验收隐患 }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>隐患编号</th>
          <th>待办标题</th>
          <th>责任班组</th>
          <th>整改期限</th>
          <th>处置结论</th>
          <th>核销日期</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todos" :key="String(todo.id)">
          <td>{{ todo['隐患编号'] }}</td>
          <td>{{ todo['待办标题'] }}</td>
          <td>{{ todo['责任班组'] }}</td>
          <td>{{ todo['整改期限'] }}</td>
          <td>{{ todo['验收结论'] || '整改未闭环' }}</td>
          <td>{{ todo['验收日期'] || '—' }}</td>
          <td>
            <span v-if="todo.pending" :class="todo.abnormal ? 'overdue-tag' : 'pending-tag'">
              {{ todo.abnormal ? '逾期待办' : '待核销' }}
            </span>
            <span v-else class="ok-text">已核销</span>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="7" class="empty-state">暂无待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>待办由隐患主表回写，不在此入口直接修改</span>
      <span :class="recon.条数一致 ? 'ok-text' : 'error-text'">
        两边条数核对：整改待办 {{ recon.待办待核销 }} ＝ 未验收隐患 {{ recon.未验收隐患 }}
        （{{ recon.条数一致 ? '一致' : '不一致' }}）
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { hazardReconciliation, listTodos } from '@/api/hazard-service'
import type { TodoRow } from '@/data/types'

const todos = ref<TodoRow[]>([])
const recon = ref(hazardReconciliation())
const closedCount = computed(() => todos.value.filter((row) => !row.pending).length)

function reload() {
  todos.value = listTodos()
  recon.value = hazardReconciliation()
}

onMounted(reload)
</script>

<style scoped>
.warn { color: #b42318; }
.ok { color: #027a48; }
.ok-text { color: #027a48; }
.pending-tag { background: #eef2f7; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.overdue-tag { color: #b42318; background: #fee4e2; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
</style>
