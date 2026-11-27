# MkDocs Web 项目上下文与后续开发指南

> 更新日期：2026-11-27。本文是已有需求、实现和开发约定的交接摘要，供后续开发者或 Agent 阅读。以仓库实际代码、配置及用户最新指令为准；不要把历史运行状态当作当前状态。

## 项目定位

- 仓库：<https://github.com/cmzhublog/mkdocsweb>；clone 地址：`https://github.com/cmzhublog/mkdocsweb.git`。
- 目标：独立实现接近 Typora 写作体验的网页版 Markdown 编辑器，支持个人文档、GitHub 仓库工作流和独立用户空间。
- Typora 本体是商业闭源软件，本项目没有复用其源码，也不是 Typora 官方产品；项目名与 Python MkDocs 静态站点生成器无关联。
- 用户沟通以中文为主，偏好直接完成修改、构建和验证，减少重复确认。涉及数据删除、凭据、权限、公开发布时仍须判断具体授权范围。
- 本文件按用户要求命名为小写 `agent.md`。不能假设所有 Agent 工具会自动加载；新会话可明确要求“先阅读仓库根目录 agent.md 和 README.md”。

## 已确认的产品需求

### 编辑体验

- 默认即时富文本编辑，同时支持 Markdown 源码和预览。
- 用户直接输入 Markdown 语法，不必依赖工具栏。
- 标题行为必须保留：输入 `## 完整标题` 时先显示原文，按回车后才渲染标题，并进入下一行正文；不能改回在 `## ` 后立即转换。
- 支持一至六级标题、行内代码、代码块、加粗、斜体、删除线、引用、列表、任务列表和分隔线。
- 代码围栏输入语言后回车创建代码块；块末另起一行输入结束围栏再回车，退出代码块。代码内不触发普通 Markdown 排版规则。
- 注意中文输入法组合阶段、撤销、行中回车、Shift+Enter、表格单元格等边界。

### 字体、目录与工具栏

- 默认宋体；提供宋体、黑体、楷体、仿宋、系统默认字体选择，保存用户偏好。
- 文档标题、正文、预览、打印和 HTML 导出使用所选字体；代码保持等宽。系统缺少字体时按字体栈回退，不下载或分发系统字体。
- 左侧以文件夹树呈现，与实际目录层级一致。每行只保留图标和单行标题，超长省略，不额外显示摘要、时间、数量。
- 新建文件与新建文件夹按钮放在同一区域。支持嵌套目录、折叠、重命名和拖动整理。
- 格式工具、插入图片、字体选择、源码模式已经移到页面最顶部，与导航、专注、导出同一行。
- 保留控件大小和现有间距，宽度不足时工具区域横向滚动，不换成多行，也不缩小控件来硬塞。
- 原生编辑器工具栏已被移动到顶部共享容器；后续改动要保留工具提示和弹层定位、缓存文档切换及窄屏滚动。

### 界面视觉约定

- 使用 `frontend-design` 梳理视觉细节，保留现有布局、控件尺寸、间距和操作路径。
- 以白色正文、浅灰绿侧栏、深墨色文字和绿色选中态形成写作空间；默认强调色为 `#34664c`，深色主题使用独立配色。
- `src/ui-polish.css` 统一界面色彩、搜索框、选中态、键盘焦点、弹窗和账号页面；与 `src/style.css` 一起由主入口和编辑器引入。
- 不添加远程字体、装饰动画或新 UI 框架。尊重减少动态效果的系统偏好。
- 编辑器库样式会随编辑器懒加载，代码块语言标签和关键控件需注意 CSS 优先级，避免再次被默认样式覆盖。
- 样式调整后检查桌面、窄屏工具栏滚动、深色弹窗以及打印规则；保持文档字体与业务行为不变。

### 代码块（最近完成）

- 使用 TOAST UI 官方代码高亮插件和 Prism，按代码围栏标注的语言着色，支持切换语言。
- 已加载 Dockerfile/Docker、Bash/Shell、Python、Nginx、YAML、JSON、JavaScript、TypeScript、Go、SQL、INI、TOML，以及 Prism 默认语言。
- 已补充 `Dockerfile`、`Python`、`Nginx`、`Bash`、`conf` 等常见写法；完整语言注册以 `src/code-highlighting.ts` 为准。
- 亮色和深色主题分别设置语法色；未知语言按普通代码显示，不自动猜测语言。
- 代码类型统一放在右上角，与语言选择弹窗位置一致；其右侧是 📋 复制按钮，无可见文字，成功短暂显示 ✅，失败显示 ❌，保留悬停提示与无障碍名称。只复制代码正文，保留缩进和换行。
- 即时编辑和 Markdown 预览均支持复制；提供 Clipboard API 与旧式复制回退，兼容现有 HTTP 部署。
- 控件在编辑器内容节点之外，不能污染 Markdown、正文或 Git 提交。
- 已修复上游插件对未知语言代码未转义 HTML 的行为。不要恢复成直接输出原始代码 HTML。
- 预览复制按钮直接附加在 `pre` 中，不额外包裹 `pre`，避免破坏编辑器增量预览的 DOM 结构。

### 图片与 assets 目录

- 已明确确认：`test.md` 的图片放在同级 `test.assets/`；例如 `docs/test.md` 对应 `docs/test.assets/`。
- Markdown 使用相对引用，例如 `![图片](test.assets/image-唯一编号.png)`。
- 支持选择、粘贴、拖拽 PNG/JPEG/GIF/WebP，单张最大 20 MiB，生成唯一名称防止覆盖。
- 图片在应用中按用户隔离、加密保存，读取需鉴权；Git 图片按固定 blob SHA 读取并缓存。
- 新图片与 Markdown 一起 push；Git 中实际生成同级 `.assets` 目录。
- 应用新建图片跟随所属文档移动；文档改名同步更新这些图片目录与引用。不要随意搬迁仓库已有、可能共享的图片。
- 支持文档与图片 ZIP 导出、JSON 备份恢复、本地目录内同名 assets 导入。

### GitHub 文档工作流

- 支持 HTTPS 和 SSH 形式的 GitHub clone 地址、分支选择、拉取、检查更改、填写说明、提交并 push。
- 实际通过 Go 后端代理 GitHub REST Git API，不运行系统 `git clone`。SSH 地址只用于解析仓库，认证仍用访问令牌。
- 公开仓库可以不填令牌导入；私有仓库和 push 需要令牌。建议限定目标仓库、授予 Contents 读写权限，不向聊天发送令牌。
- 已取消最初的 300 份文档、单份 2 MB、总计 8 MB 导入限制。
- 为提高导入速度，先读取仓库元信息和目录树，点击文件时再按固定版本下载正文；缓存已打开文件并合并重复请求。
- 未加载内容不能当作空文档提交；未打开文件的改名、移动沿用原 blob，拉取按 SHA 验证缓存。
- push 以原 Git tree 为基础保留其他文件，文档和新图片形成一次提交，禁止强制推送。
- 远端变化或本地未提交改动会阻止覆盖；当前无自动冲突合并。
- 全文搜索只覆盖标题及已缓存正文。Git 不追踪空目录；不支持 GitHub Enterprise、子模块和符号链接文档。
- 仍有 64 MiB 工作区保存及 Git API 代理请求/响应保护；取消导入数量限制不等于无限资源。

## 后端、用户与安全要求

- 后端必须使用 Go，当前部署使用独立 PostgreSQL 容器。
- 禁止开放注册；管理员创建、停用用户、调整权限和重置密码。
- 用户之间文档、图片、仓库连接和令牌隔离；管理员账号管理能力不意味着能经 API 查看其他用户文档。
- 业务 API 必须鉴权，用户归属由服务端会话确定，不接受客户端任意指定用户归属。登录和静态资源是必要例外。
- 写接口有同源 Origin、CSRF 和页面用户身份校验，防止其他标签切换账号后错写。
- 密码使用 Argon2id 加盐哈希；数据和 Git 连接凭据使用 AES-256-GCM 加密保存，随机 nonce，附加认证数据绑定类型与所属用户。
- 会话使用 HttpOnly、SameSite=Strict Cookie，数据库存会话 ID 哈希；权限、密码或账号状态变化撤销会话。
- Git 令牌仅后端解密使用，不返回前端，不写入 localStorage、JSON 备份、URL 或日志。
- Git 代理限制固定 GitHub API 目标和必要路径，拒绝任意代理 URL、重定向及强推。
- 历史需求曾提出接口“加密和鉴权”；后续用户明确选择暂不使用 HTTPS，日后自行在 Nginx 配置。因此当前 HTTP 没有传输加密，不能声称所有网络接口已加密，也不要自行添加不兼容的应用层加密协议。
- 存储加密不是端到端加密；持有服务端主密钥的人具有解密能力。
- 主密钥必须独立备份；禁止在已有数据上随意重新生成或替换密钥。账号、数据库和密钥的真实值不得进入版本库、日志或交接文档。

## 技术架构与代码入口

前端：TypeScript 严格模式、Vite、TOAST UI Editor 3.2.3、ProseMirror、DOMPurify、Lucide、fflate、Prism。
后端：Go（`go.mod` 当前要求 1.26.11）、pgx/PostgreSQL 17、Argon2id、AES-GCM；仍保留旧版 bbolt 迁移兼容。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts`、`src/api.ts`、`src/account.ts` | 登录入口、后端请求、会话和账号管理 |
| `src/editor.ts` | 页面布局、文档切换、编辑器缓存、工具栏挂载和导出 |
| `src/editor-toolbar.ts` | 原生工具栏复用、单行滚动、弹层和提示定位 |
| `src/markdown-shortcuts.ts` | Markdown 输入规则及回车转换 |
| `src/code-highlighting.ts` | Prism 语言注册、安全代码高亮 |
| `src/code-blocks.ts` | 高亮插件适配、代码复制、预览控件及清理 |
| `src/style.css`、`src/ui-polish.css` | 布局、字体、响应式、主题、语法色及界面视觉细节 |
| `src/documents.ts`、`src/autosave.ts` | 工作区与目录模型、保存队列和冲突处理 |
| `src/github.ts`、`src/git-ui.ts`、`src/git-types.ts` | GitHub 文档工作流与仓库面板 |
| `src/images.ts`、`src/image-editor.ts`、`src/image-export.ts` | 图片资产、鉴权预览、导出 |
| `backend/server.go`、`backend/workspace.go` | HTTP、会话、鉴权、账号和工作区 API |
| `backend/store.go`、`backend/database.go` | 加密存储、事务及 PostgreSQL/旧存储兼容 |
| `backend/git.go`、`backend/images.go` | GitHub 代理、凭据及图片接口 |
| `backend/config.go`、`backend/main.go` | 配置、启动、初始化和 CLI |
| `tests/`、`backend/*_test.go` | 前端行为及后端集成测试 |
| `compose.yaml`、`Dockerfile`、`scripts/setup-compose.sh` | 本地容器编译部署与密钥初始化 |
| `deploy/nginx.conf.example`、`deploy/postgres/` | 后续反向代理示例和数据库初始化 |

## 本地编译和部署

推荐使用 Docker Compose，数据库与所需服务一并部署，目前不依赖 Redis 或消息队列。

```sh
# 首次初始化；已有密钥会保留
./scripts/setup-compose.sh
# 构建、部署并等待健康检查
docker compose up -d --build --wait
# 检查状态
docker compose ps -a
```

- 当前默认访问地址：<http://localhost:8080/>。`.env` 的 `APP_ORIGIN` 必须与浏览器来源严格一致，无末尾斜杠；`localhost` 和 `127.0.0.1` 不是同一来源。
- 默认 `BIND_ADDR=127.0.0.1`、`APP_PORT=8080`、`ALLOW_HTTP=true`。不要未经授权改成公网监听。
- 服务：`app` 为前后端同源应用；`db` 为 PostgreSQL；`init` 一次性创建首个管理员；`test` 为可选后端测试 profile。
- 初始用户名默认 `admin`；初始密码在本机 `.secrets/admin_password`，不要将其写进本文。`init` 不会重置已有账号。
- `.env`、`.secrets/` 不提交。数据库保存在 `postgres_data` 命名卷；普通 `docker compose down` 保留卷，禁止为了更新代码执行 `down -v`。
- 更新前端后要重新构建镜像；仅重启不会编译新代码。`npm run dev` 是前端开发入口，完整登录、保存使用 Compose。
- Nginx 后续由用户处理：配置 HTTPS 后设置 `APP_ORIGIN=https://实际域名`、`ALLOW_HTTP=false` 和真实 `TRUSTED_PROXY_CIDR`；参考 README 与代理示例，不猜测信任网段。
- PostgreSQL 备份与主密钥分别保管。旧 bbolt 迁移需使用旧密钥与空目标库，按 README 的迁移步骤执行，不自动混合旧数据。

## 验证与迭代约定

```sh
# 前端（本机开发要求 Node.js 24+）
npm ci
npm test
npm run build

# 后端（Go 版本以 backend/go.mod 为准）
(cd backend && go test -race ./...)
(cd backend && go vet ./...)

# PostgreSQL 集成测试：使用独立临时 schema，不读写现有用户数据
docker compose --profile test run --rm --build test

git diff --check
```

- 根据改动运行相关检查；纯文档修改无需重建服务或运行全套业务测试。
- 涉及编辑器 DOM 的功能需真实浏览器验证。重点检查输入法、光标、撤销、源码往返、缓存文档切换，以及复制或语言标签不会混入正文。
- 测试时不要改写用户现有文档；优先使用隔离的临时页面或测试数据，完成后清理临时文件和开发进程。
- 预览 DOM 调整不得破坏 TOAST UI 增量渲染；编辑控件不要插入 ProseMirror 的内容节点。
- 保持 DOMPurify 清洗和未知语言 HTML 转义；不要通过关闭清洗来解决样式问题。
- 当前 TOAST UI 编辑器及官方插件已停止维护，依赖锁定于验证版本；DOMPurify 通过 npm overrides 统一。更换或升级内核前要验证中文输入、Markdown 往返与粘贴清洗。
- 大纲、搜索和图片处理应继续尊重仓库懒加载，不重新引入逐篇下载的慢导入行为。
- 现阶段暂不支持数学公式、Mermaid、实时协作及自动 Git 冲突合并。富文本转换会规范化部分 Markdown 格式，不保证复杂 HTML 无损往返。

## 最近完成与交接状态

- `9a89bb1`：同级 `.assets` 图片工作流。
- `eb15347`：完整控件保持单行、超出横向滚动。
- `39286f6`：编辑工具合并到页面最顶部。
- `6afe962`：代码块语法高亮与快速复制、安全处理未知语言。
- 上一次功能变更验证：前端构建通过，50 项前端测试通过；浏览器验证了指定语言着色、预览、深色主题、复制缩进和 Markdown 原文不混入按钮文字。
- 上一次部署：`docker compose up -d --build --wait` 成功，应用与数据库健康；这些是历史结果，新会话应按需重新核实。
- 上述功能提交已推送到 `origin/main`。后续修改前检查 `git status`、当前分支和远端，保留用户未提交改动，不强推。
- 本地工作路径不是项目运行依赖。新机器从仓库初始化配置即可，不要硬编码上一台机器的绝对路径。

## 后续会话可用提示

“请先阅读仓库根目录的 agent.md 和 README.md，核对当前分支与工作区状态，再继续修改。保留已有的用户隔离、加密存储、标题回车渲染、顶部单行工具栏、同级 assets 图片和 Git 懒加载行为；完成后做与改动相符的验证，并按本次授权提交部署。”
