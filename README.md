# LaMa 图片修复

纯前端图片修复工具，基于 Vue 3、LaMa 和 ONNX Runtime Web。上传或拖入图片，用圆形画笔标记需要去除的部分，使用 WASM 在浏览器本地修复。

页面支持缩放、拖动画布、擦除选区、撤销修复、原图对比和 PNG 导出。图片不会上传到服务器。

## 本地运行

需要 Node.js 24 和 npm。

```sh
npm ci
npm run model:fetch
npm run dev
```

首次下载模型约 208MB。模型校验通过后可离线重复使用；运行时也会尽量使用浏览器缓存。浏览器缓存可能被清理，不能保证永久离线可用。

```sh
npm run build
npm run preview
```

## GitHub Pages

仓库包含 `.github/workflows/pages.yml`：推送 `main` 或手动运行工作流时，自动安装依赖、下载校验模型、构建并发布 `dist/`。

首次使用在仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。如果此前工作流因 Pages 未启用而失败，在 Actions 中重新运行即可。

预期访问地址：<https://yism1998.github.io/tools/>。仅工作流成功且页面可访问后才代表发布完成。

构建通过 `BASE_PATH` 适配 Pages 项目子目录，也可在本地验证同一路径：

```sh
BASE_PATH=/tools/ npm run build
BASE_PATH=/tools/ npm run preview
```

然后访问预览服务器的 `/tools/`。

### 模型分发

模型保存在本仓库的 [lama-model-v1 Release](https://github.com/yism1998/tools/releases/tag/lama-model-v1) 中，不进入 Git 历史。`model.json` 固定下载地址、原始来源版本、文件大小和 SHA-256，`scripts/fetch-model.mjs` 从本仓库 Release 下载并校验；校验失败会终止构建。Actions 缓存模型，但每次构建仍校验文件内容。

模型与 WASM 都随 Pages 产物同源发布，浏览器无需直接访问 Hugging Face。首次加载传输约 208MB 模型和 14MB WASM，需要考虑 Pages 的带宽配额。

### 模型压缩评估

可以先压缩模型，再在浏览器的推理 Worker 中解压后交给 ONNX Runtime。2026-10-27 对 `model.json` 固定的 FP32 模型使用 Node.js `node:zlib` 实测（MB 按 1,000,000 字节计算）：

| 格式 | 字节数 | 大小 | 相比原文件减少 |
| --- | ---: | ---: | ---: |
| 原始 ONNX | 208,044,816 | 208.04 MB | — |
| gzip，level 9 | 189,935,149 | 189.94 MB | 8.70% |
| Brotli，quality 6 | 189,564,402 | 189.56 MB | 8.88% |

无损压缩不会改变模型结果，但当前模型的收益约为 18 MB，解压后的模型仍为 208 MB，也不会降低推理所需内存。当前版本保持原模型分发，以上是评估结果，尚未启用压缩加载。

- 如果继续使用 GitHub Pages，可在构建时生成 `.onnx.gz`，在 Worker 中使用原生 [`DecompressionStream('gzip')`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) 流式解压，按压缩文件的字节数显示下载进度，并对解压结果校验大小和 SHA-256。解压缓存需要带模型版本；不支持此 API 的浏览器需要回退到原文件。若服务器已通过 `Content-Encoding: gzip` 自动解压，应用不能再次解压。
- 如果使用能够配置 HTTP 响应头的托管服务，可让服务端协商 gzip/Brotli，浏览器自动解压，应用继续请求原来的 ONNX 地址。仅上传 `.gz` 文件不会自动实现这一步。
- 要显著降低下载量，需要进一步评估 [FP16](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html) 或 [INT8 量化](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)：权重存储理论上分别约为 FP32 的一半、四分之一，最终文件大小取决于可转换的算子和权重。它们会改变数值精度，必须验证当前 `onnxruntime-web/wasm` 的算子兼容性、推理速度及图片修复质量，不能直接替换。

### 访问统计

`index.html` 已按 [Cloudflare 的手动接入方式](https://developers.cloudflare.com/web-analytics/get-started/) 加入 Web Analytics，使用 `type="module"` 加载统计脚本。部署后需在 Cloudflare Web Analytics 中确认该 token 对应的站点 hostname 与实际访问域名一致（默认 Pages 域名为 `yism1998.github.io`）。图片修复仍在本地执行，统计脚本只用于访问与性能统计。

### WASM 多线程

固定使用 WASM，不请求 WebGPU。开发和预览服务器配置了 COOP/COEP 响应头。

GitHub Pages 不能通过 Vite 配置自定义这些响应头，因此额外提供同源的 `coi-serviceworker`。支持的浏览器首次访问可能自动刷新一次以启用跨源隔离；不支持 Service Worker、隔离失败或浏览器不支持多线程时，回退为单线程。隔离成功时最多使用 4 个 CPU 线程。

应用位于 `/tools/` 时，Service Worker 的作用域也限定在 `/tools/`，不会控制该域名下其他项目。

`scripts/copy-coi.mjs` 在安装时为固定版本的 Service Worker 应用补丁：仅拦截同源 GET，为页面、模型和 WASM 保留隔离响应头；跨域请求与 POST（包括 Cloudflare 上报）交由浏览器处理。网络失败保持 Promise rejection，避免上游错误处理返回空值导致 `respondWith` 二次报错。运行 `npm test` 验证这些行为。

如果统计上报仍失败，请确认 Cloudflare Web Analytics 的 hostname 为实际访问域名（Pages 默认为 `yism1998.github.io`），并检查浏览器扩展或网络是否拦截 `cloudflareinsights.com`。更新部署后，现有标签页可能仍受旧版 Service Worker 控制，需要刷新以启用新版本。

## 使用与限制

- 支持 PNG、JPG、WebP；文件拖入仅本地读取。
- 画笔为圆形，可调大小；滚轮或加减按钮缩放，点击百分比恢复原始尺寸，四角按钮适应画布。
- 移动工具、空格拖动或鼠标中键可移动画布。
- 撤销最多保留 8 步，支持 Ctrl/Cmd+Z。
- 工作图长边最多 4096，最多 800 万像素；超出时缩小并提示。
- 推理针对涂抹区域及其周围背景，适配至 512×512；只回填选区内像素，保留选区外工作图的 RGBA。
- 修复区域是模型预测，不保证恢复真实原图；大面积遮挡、正文、人脸和产品细节需要检查。
- 单次处理超过 150 秒会停止 Worker，并保留涂抹区域。

## 来源与许可证

- 原模型：[advimman/lama](https://github.com/advimman/lama)。
- ONNX 模型：[Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX)，版本及校验信息见 `model.json`，Apache-2.0，许可证见 `public/models/LICENSE`。
- 示例照片来自同模型仓库 `image.jpg`，仅供功能演示。
- ONNX Runtime Web：MIT；Vue：MIT；coi-serviceworker：MIT。分发产物中的第三方许可证见 `public/licenses/`。
