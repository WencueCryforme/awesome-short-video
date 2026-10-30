<template>
  <Teleport to="body">
    <Transition name="bubble">
      <div v-if="open" class="topic-popover-layer" @click.self="emit('apply')">
        <div class="topic-bubble" :style="bubbleVars" role="dialog" aria-label="选择话题">
          <div
            ref="viewportEl"
            class="topic-bubble-viewport"
            @scroll.passive="onScroll"
            @wheel="onWheel"
          >
            <div class="topic-grid">
              <button
                v-for="tag in tags"
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
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { TOPIC_BUBBLE } from '~/const'

const props = defineProps<{
  open: boolean
  tags: string[]
  selected: string[]
}>()

const emit = defineEmits<{
  toggle: [tag: string]
  apply: []
}>()

/* 滚动发生在气泡内的视区层,气泡本体只负责外观与留白 */
const viewportEl = ref<HTMLElement | null>(null)

/* 横向滚动位置的内存缓存,关闭气泡后仍然保留,不写入本地存储 */
const scrollLeft = ref(0)

const bubbleVars = computed(() => ({
  '--topic-gap': TOPIC_BUBBLE.gap + 'px',
  '--topic-padding': TOPIC_BUBBLE.padding + 'px',
  '--topic-border': TOPIC_BUBBLE.border + 'px'
}))

function onScroll() {
  const element = viewportEl.value
  if (element) {
    scrollLeft.value = element.scrollLeft
  }
}

/* 竖直滚轮转为横向滚动,只在内容溢出时接管,其余情况交给页面 */
function onWheel(event: WheelEvent) {
  const element = viewportEl.value
  if (!element || element.scrollWidth <= element.clientWidth) {
    return
  }

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) {
    return
  }

  event.preventDefault()
  element.scrollLeft += delta
  scrollLeft.value = element.scrollLeft
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return
    }

    await nextTick()
    const element = viewportEl.value
    if (element) {
      element.scrollLeft = scrollLeft.value
    }
  }
)

watch(
  () => props.tags,
  async () => {
    if (!props.open) {
      return
    }

    /* 标签变化后内容长度随之改变,滚动位置可能越界,收敛后同步缓存 */
    await nextTick()
    const element = viewportEl.value
    if (element) {
      element.scrollLeft = scrollLeft.value
      scrollLeft.value = element.scrollLeft
    }
  }
)
</script>
