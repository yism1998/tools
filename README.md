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

### WASM 多线程

固定使用 WASM，不请求 WebGPU。开发和预览服务器配置了 COOP/COEP 响应头。

GitHub Pages 不能通过 Vite 配置自定义这些响应头，因此额外提供同源的 `coi-serviceworker`。支持的浏览器首次访问可能自动刷新一次以启用跨源隔离；不支持 Service Worker、隔离失败或浏览器不支持多线程时，回退为单线程。隔离成功时最多使用 4 个 CPU 线程。

应用位于 `/tools/` 时，Service Worker 的作用域也限定在 `/tools/`，不会控制该域名下其他项目。

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
