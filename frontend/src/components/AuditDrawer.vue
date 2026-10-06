<template>
  <ModalDialog :open="open" :title="`留痕记录 · ${code}`" @close="$emit('close')">
    <table v-if="entries.length" class="data-table audit-table">
      <thead>
        <tr><th>时间</th><th>动作</th><th>操作人</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.id">
          <td>{{ fmt(e.time) }}</td>
          <td>{{ e.action }}</td>
          <td>{{ e.operator }}</td>
          <td>{{ e.detail }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty-state">该隐患暂无留痕记录</p>
  </ModalDialog>
</template>

<script setup lang="ts">
import type { AuditEntry } from '@/data/types'
import ModalDialog from './ModalDialog.vue'

defineProps<{ open: boolean; code: string; entries: AuditEntry[] }>()
defineEmits<{ (e: 'close'): void }>()

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<style scoped>
.audit-table td { vertical-align: top; }
</style>
