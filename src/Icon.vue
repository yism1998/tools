<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  brush: 'm14 4 6 6M5 15 17 3a2.8 2.8 0 0 1 4 4L9 19M5 15l4 4M5 15l-2 6 6-2',
  eraser: 'm14 4 7 7a1.5 1.5 0 0 1 0 2l-7 7H7l-5-5a1.5 1.5 0 0 1 0-2l10-9a1.5 1.5 0 0 1 2 0ZM7 9l9 9M14 20h8',
  hand: 'M8 12V5a2 2 0 0 1 4 0v7m0-1V4a2 2 0 0 1 4 0v8m0-1V7a2 2 0 0 1 4 0v7c0 5-3 8-7 8-3 0-5-1-7-4l-4-6a2 2 0 0 1 3-2l3 3m12 0v-2a2 2 0 0 1 2-2',
  undo: 'M3 10h11a6 6 0 0 1 0 12h-3M3 10l5-5M3 10l5 5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6',
  plus: 'M5 12h14M12 5v14', minus: 'M5 12h14',
  fit: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 16l6-6 5 5 3-3 4 4M16 7h.01',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2ZM12 14v3',
  compare: 'M12 3v18M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4m6-14h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4',
  check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
};
</script>
<template><svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.image" /></svg></template>
