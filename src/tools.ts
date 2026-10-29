import WatermarkPage from './pages/WatermarkPage.vue';

// Add future tools here; the shell owns navigation and preserves page state.
export const tools = [
  { id: 'watermark', label: '水印清除', icon: 'spark', component: WatermarkPage },
] as const;

export function toolFromHash(hash: string) {
  return tools.find(tool => hash === `#/${tool.id}`) || tools[0];
}
