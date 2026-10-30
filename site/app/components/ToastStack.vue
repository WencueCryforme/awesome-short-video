<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast" leave-active-class="toast-leave-instant">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="toast"
        :class="'toast--' + item.tone"
        @click="dismiss(item.id)"
      >
        {{ item.message }}
      </button>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
const { items, dismiss } = useToast()
</script>
