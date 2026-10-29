import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const canonical = 'https://yism1998.github.io/tools/';
assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
assert.ok(html.includes(`rel="canonical" href="${canonical}"`));
assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, '首页应包含一个明确的主标题');
assert.match(html, /<h1[^>]*>在线水印清除<\/h1>/);
assert.ok(!html.includes('<div id="app"></div>'), '首页正文必须存在于原始 HTML');
assert.match(html, /<nav[^>]*aria-label="工具导航"/);
assert.match(html, /href="#\/watermark"[^>]*aria-current="page"/);
const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const page = schema['@graph'].find(node => node['@type'] === 'WebPage');
assert.equal(page.url, canonical);
assert.equal(page.isPartOf['@id'], canonical + '#website');
assert.ok(!JSON.stringify(schema).includes('aggregateRating'), '不得添加不存在的评分');
const sitemap = await readFile(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
const image = await readFile(new URL('../dist/og-image.png', import.meta.url));
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
for (const path of ['../public/google86f67cc58c6da880.html', '../dist/google86f67cc58c6da880.html']) {
  assert.equal(await readFile(new URL(path, import.meta.url), 'utf8'), 'google-site-verification: google86f67cc58c6da880.html');
}
const cssPath = html.match(/href="[^"]*assets\/([^"/]+\.css)"/)[1];
const css = await readFile(new URL(`../dist/assets/${cssPath}`, import.meta.url), 'utf8');
for (const scope of new Set(html.match(/data-v-[a-f\d]+/g))) {
  assert.ok(css.includes(scope), `SSR 与生产 CSS 作用域不一致：${scope}`);
}
console.log('SEO 校验通过：静态正文、主标题、canonical、结构化数据、分享图、sitemap 和 Google 验证文件。');
