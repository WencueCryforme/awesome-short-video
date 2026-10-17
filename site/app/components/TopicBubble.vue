<template>
  <Teleport to="body">
    <div v-if="open" ref="measureEl" class="topic-measure" aria-hidden="true">
      <button v-for="tag in tags" :key="tag" type="button" class="topic-chip">{{ tag }}</button>
    </div>

    <Transition name="bubble">
      <div v-if="open" class="topic-popover-layer" @click.self="emit('apply')">
        <div
          class="topic-bubble"
          :class="{ 'is-ready': bubbleWidth > 0 }"
          :style="bubbleWidth > 0 ? { width: bubbleWidth + 'px' } : undefined"
          role="dialog"
          aria-label="选择话题"
        >
          <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="topic-row">
            <button
              v-for="tag in row"
              :key="tag"
              type="button"
              class="topic-chip"
              :class="{ 'is-selected': selected.includes(tag) }"
              :aria-pressed="selected.includes(tag)"
              @click.stop="emit('toggle', tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
  tags: string[]
  selected: string[]
}>()

const emit = defineEmits<{
  toggle: [tag: string]
  apply: []
}>()

const measureEl = ref<HTMLElement | null>(null)
const perRow = ref(1)
const bubbleWidth = ref(0)
const GAP = 6
const PADDING = 10
const BORDER = 1

const rows = computed(() => {
  const size = Math.max(perRow.value, 1)
  const result: string[][] = []
  for (let index = 0; index < props.tags.length; index += size) {
    result.push(props.tags.slice(index, index + size))
  }
  return result
})

function widthOfRow(widths: number[]) {
  return widths.reduce((sum, width) => sum + width, 0) + Math.max(widths.length - 1, 0) * GAP
}

function layoutBubble() {
  if (!import.meta.client || !props.open) {
    return
  }
  const container = measureEl.value
  if (!container) {
    return
  }
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
  if (!buttons.length) {
    perRow.value = 1
    bubbleWidth.value = 0
    return
  }

  const widths = buttons.map(button => button.getBoundingClientRect().width)
  const app = document.querySelector<HTMLElement>('.app-view')
  const uiWidth = app?.getBoundingClientRect().width || window.innerWidth
  const maxOuter = Math.max(120, Math.min(uiWidth, window.innerWidth) - 24)
  const contentMax = maxOuter - (PADDING + BORDER) * 2

  if (!widths.some(width => width > 0)) {
    perRow.value = 1
    bubbleWidth.value = maxOuter
    return
  }

  let best = 1
  for (let size = props.tags.length; size >= 1; size -= 1) {
    let fits = true
    for (let start = 0; start < widths.length; start += size) {
      if (widthOfRow(widths.slice(start, start + size)) > contentMax) {
        fits = false
        break
      }
    }
    if (fits) {
      best = size
      break
    }
  }

  perRow.value = best
  const rowWidths: number[] = []
  for (let start = 0; start < widths.length; start += best) {
    rowWidths.push(widthOfRow(widths.slice(start, start + best)))
  }
  bubbleWidth.value = Math.min(maxOuter, Math.max(...rowWidths) + (PADDING + BORDER) * 2)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return
    }
    bubbleWidth.value = 0
    await nextTick()
    layoutBubble()
  }
)

watch(
  () => props.tags,
  async () => {
    if (!props.open) {
      return
    }
    bubbleWidth.value = 0
    await nextTick()
    layoutBubble()
  }
)

function onResize() {
  if (props.open) {
    layoutBubble()
  }
}

onMounted(() => {
  if (props.open) {
    nextTick().then(layoutBubble)
  }
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})
</script>
