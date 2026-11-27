# MkDocs Web

一个简洁、专注、本地优先的网页版 Markdown 编辑器。灵感来自 Typora 的即时写作体验。

> Typora 本体是商业闭源软件。本项目独立实现，不包含 Typora 源码，也不属于 Typora 官方产品。名称中的 MkDocs 与 Python 的 MkDocs 静态站点生成器无关联。

## 已实现

- 所见即所得编辑与 Markdown 源码 / 预览切换
- 标题、加粗、斜体、引用、列表、任务列表、表格、链接、代码块
- 多文档创建、重命名、删除与全文搜索
- 浏览器本地自动保存、刷新恢复，存储失败提示
- 动态文档大纲与点击跳转、字符统计、阅读时间
- Markdown / TXT 导入，Markdown / HTML 导出
- 全文档 JSON 备份与合并恢复
- 打印 / 存为 PDF、专注模式、深浅主题、移动端布局
- GitHub Pages 自动部署工作流

## 本地运行

需要 Node.js 22.18+（推荐 Node.js 24 LTS）和 npm。

```sh
npm ci
npm run dev
```

打开终端中显示的本地地址，默认 `http://127.0.0.1:5173/`。

```sh
npm test       # 存储恢复、大纲解析、文件名和字符统计测试
npm run build # TypeScript 检查和生产构建
npm run preview
```

## 部署

仓库已提供 `.github/workflows/deploy.yml`：

1. 在 GitHub 仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
2. 推送代码到 `main`，或在 Actions 中手动运行 **Deploy to GitHub Pages**。
3. 在成功的工作流中打开返回的网站地址。对于当前仓库，默认路径为 `https://cmzhublog.github.io/mkdocsweb/`。

构建时自动配置仓库子路径。上述 URL 只有在工作流部署成功后才可访问。

也可部署到任意静态托管服务，构建命令为 `npm run build`，输出目录为 `dist`。部署到子路径时使用 `npm run build -- --base=/你的路径/`。

## 数据和当前边界

文档存储在当前来源（协议、域名、端口）的 `localStorage`，没有账号、后端或云端同步。清理浏览器数据、切换浏览器、无痕模式、换域名或端口都会影响文档可见性。重要内容请定期导出 Markdown 或全文档备份；备份恢复采用合并方式，保留已有文档。

自动保存失败会显示提示。检测到其他标签页写入时，当前标签页暂停保存，避免相互覆盖；先导出当前未保存内容再刷新。损坏存储不会被欢迎文档自动覆盖。

首版支持常用 GFM 语法；暂不包含数学公式、Mermaid、文件夹、图片上传、实时协作或 GitHub 文档同步。Markdown 与富文本转换可能规范化空白、列表等原始格式，复杂嵌入 HTML 不保证无损往返。PDF 通过浏览器打印生成。

编辑器关闭 TOAST UI 使用统计。页面不主动上传文档；文档中的外部图片和链接仍由浏览器访问。字体使用系统字体，无需第三方字体服务。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| ⌘ / Ctrl + Shift + N | 新建文档 |
| ⌘ / Ctrl + K | 搜索文档 |
| ⌘ / Ctrl + S | 保存至本地 |
| ⌘ / Ctrl + / | 切换源码模式 |
| ⌘ / Ctrl + B / I | 加粗 / 斜体 |
| Esc | 退出专注模式 |

## 技术与许可证

TypeScript + Vite + [TOAST UI Editor](https://github.com/nhn/tui.editor) + [DOMPurify](https://github.com/cure53/DOMPurify) + [Lucide](https://lucide.dev/)。本项目使用 MIT 许可证，依赖保留各自许可证。

TOAST UI Editor 当前 npm 版本已标记为不再维护，首版使用其成熟的 Markdown / 富文本编辑能力，并通过 npm overrides 将其旧 DOMPurify 依赖统一至当前修复版本。锁文件固定经过验证的依赖；后续升级前需复测中文输入、Markdown 往返与粘贴清洗，长期迭代建议迁移至持续维护的编辑器内核。
