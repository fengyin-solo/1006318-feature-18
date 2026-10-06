<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ (e: 'close'): void }>()
</script>
