<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-layer" @click.self="emit('close')">
        <aside class="drawer" aria-label="侧边栏">
          <div class="drawer__brand">
            <span class="drawer__mark" aria-hidden="true">
              <span class="drawer__triangle"></span>
            </span>
            <div>
              <p class="drawer__title">{{ site.title }}</p>
              <p class="drawer__sub">{{ site.subtitle }}</p>
            </div>
            <button type="button" class="drawer__close" aria-label="收起侧边栏" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"></path>
              </svg>
            </button>
          </div>

          <div class="drawer__identity">
            <a class="drawer__author" :href="site.author.url" target="_blank" rel="noopener noreferrer">
              @{{ site.author.name }}
            </a>
            <p class="drawer__note">个人版竖屏短视频流</p>
          </div>

          <a class="drawer__repo" :href="site.repositoryUrl" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
            </svg>
            <span>GitHub 仓库</span>
          </a>

          <section class="drawer__settings">
            <div class="drawer__row">
              <div class="drawer__row-text">
                <p class="drawer__row-title">主题</p>
                <p class="drawer__row-desc">{{ isLight ? '当前为亮色' : '当前为暗色' }}</p>
              </div>
              <button
                type="button"
                class="switch"
                :class="{ 'is-on': isLight }"
                role="switch"
                :aria-checked="isLight"
                aria-label="切换亮色与暗色主题"
                @click="toggleTheme"
              >
                <span class="switch__knob"></span>
              </button>
            </div>

          </section>

          <footer class="drawer__footer">
            <p>版本 {{ site.version }}</p>
            <p>Copyright &copy; {{ site.copyrightYear }} {{ site.author.name }}</p>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { SITE as site } from '~/const'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { isLight, toggle: toggleTheme } = useTheme()
</script>
