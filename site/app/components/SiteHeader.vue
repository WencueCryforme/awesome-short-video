<template>
  <header class="site-header">
    <div class="shell site-header__inner">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          <span class="brand__triangle"></span>
        </span>
        <div class="brand__text">
          <p class="brand__title">{{ site.title }}</p>
          <p class="brand__subtitle">{{ site.subtitle }}</p>
        </div>
      </div>
      <a class="ghost-button" :href="site.repositoryUrl" target="_blank" rel="noopener noreferrer">
        GitHub 仓库
      </a>
    </div>
  </header>
</template>

<script setup lang="ts">
import { SITE as site } from '~/utils/site'
</script>
