<template>
  <footer class="site-footer">
    <div class="shell site-footer__inner">
      <p class="site-footer__author">
        Copyright &copy; {{ site.copyrightYear }}
        <a :href="site.author.url" target="_blank" rel="noopener noreferrer">{{ site.author.name }}</a>
      </p>
      <p class="site-footer__note">
        所有视频均来源于互联网并标注来源,如有侵权请联系删除
      </p>
      <p class="site-footer__meta">
        版本 {{ site.version }}
        <span class="site-footer__dot" aria-hidden="true"></span>
        <a :href="site.repositoryUrl" target="_blank" rel="noopener noreferrer">源码仓库</a>
      </p>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { SITE as site } from '~/utils/site'
</script>
