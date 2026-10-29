<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
import { tools, toolFromHash } from './tools';

const activeId = ref<string>(tools[0].id);
const activeTool = computed(() => tools.find(tool => tool.id === activeId.value) || tools[0]);
function syncLocation() { activeId.value = toolFromHash(window.location.hash).id; }
onMounted(() => {
  syncLocation();
  window.addEventListener('hashchange', syncLocation);
});
onUnmounted(() => window.removeEventListener('hashchange', syncLocation));
</script>

<template>
  <div class="toolbox-app">
    <header class="toolbox-header">
      <a class="toolbox-brand" :href="`#/${tools[0].id}`" aria-label="Tools 工具箱首页">
        <span class="brand-icon"><Icon name="spark" :size="21" /></span>
        <b>Tools</b><span>工具箱</span>
      </a>
      <nav class="tool-tabs" aria-label="工具导航">
        <a v-for="tool in tools" :key="tool.id" :href="`#/${tool.id}`"
          :class="['tool-tab', { active: activeTool.id === tool.id }]"
          :aria-current="activeTool.id === tool.id ? 'page' : undefined">
          <Icon :name="tool.icon" :size="17" /><span>{{ tool.label }}</span>
        </a>
      </nav>
    </header>
    <KeepAlive>
      <component :is="activeTool.component" :key="activeTool.id" />
    </KeepAlive>
  </div>
</template>
