<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。隐患相关数字与隐患列表、导出、待办同口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="block-title">隐患整改口径核对</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">隐患总数（列表同源）</span>
        <strong class="stat-value">{{ recon.隐患总数 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未验收隐患</span>
        <strong class="stat-value">{{ recon.未验收隐患 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">整改待办待核销</span>
        <strong class="stat-value" :class="{ warn: !recon.条数一致 }">{{ recon.待办待核销 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">同步至评估清单</span>
        <strong class="stat-value">{{ recon.评估清单条数 }}</strong>
      </article>
    </div>
    <p :class="recon.条数一致 ? 'ok-text' : 'error-text'" class="recon-line">
      {{ recon.条数一致
        ? `报表与明细对得上：未验收隐患 ${recon.未验收隐患} 条 ＝ 整改待办 ${recon.待办待核销} 条`
        : `口径不一致：未验收隐患 ${recon.未验收隐患} ≠ 待办 ${recon.待办待核销}` }}
    </p>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td :class="{ warn: row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，退出再打开数据仍在；隐患异常量即「逾期隐患」，验收通过即清零</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { hazardReconciliation } from '@/api/hazard-service'
import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const recon = ref(hazardReconciliation())

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  recon.value = hazardReconciliation()
}

onMounted(refresh)
</script>

<style scoped>
.block-title { font-size: 15px; margin: 18px 0 8px; }
.warn { color: #b42318; }
.ok-text { color: #027a48; }
.recon-line { font-size: 13px; margin: 0 0 14px; }
</style>
