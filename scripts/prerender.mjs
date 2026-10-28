import { readFile, writeFile } from 'node:fs/promises';

// Match the production Vue compiler (including scoped CSS IDs) for hydration.
process.env.NODE_ENV = 'production';
const [{ createServer }, { createSSRApp }, { renderToString }] = await Promise.all([
  import('vite'), import('vue'), import('vue/server-renderer'),
]);
const server = await createServer({
  mode: 'production', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const { default: App } = await server.ssrLoadModule('/src/App.vue');
  const markup = await renderToString(createSSRApp(App));
  const entry = new URL('../dist/index.html', import.meta.url);
  const html = await readFile(entry, 'utf8');
  const mount = '<div id="app"></div>';
  if (!html.includes(mount)) throw new Error('预渲染未找到唯一的应用挂载点。');
  await writeFile(entry, html.replace(mount, `<div id="app">${markup}</div>`));
  console.log('已预渲染首页正文，生产页面使用 Vue hydration 接管交互。');
} finally { await server.close(); }
