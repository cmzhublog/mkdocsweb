# MkDocs Web

一个简洁、专注、支持独立账号的网页版 Markdown 编辑器。灵感来自 Typora 的即时写作体验。

> Typora 本体是商业闭源软件。本项目独立实现，不包含 Typora 源码，也不属于 Typora 官方产品。名称中的 MkDocs 与 Python 的 MkDocs 静态站点生成器无关联。

## 已实现

- 所见即所得编辑与 Markdown 源码 / 预览切换
- 即时编辑中点击写作区空白，在附近创建新行并将光标移到行首；相邻空行可复用
- 直接输入 Markdown 自动排版：标题、代码、加粗、斜体、列表、引用等
- 标题、加粗、斜体、引用、列表、任务列表、表格、链接、代码块
- `flow` / `flowchart` 代码块渲染流程图，支持源码编辑、复制、主题适配和 HTML 图形导出
- 多文档创建、重命名、删除与全文搜索
- 精简文件夹树、嵌套目录、折叠展开、目录导入和拖动整理
- 账号内自动保存、刷新恢复、版本冲突保护和保存失败提示
- 动态文档大纲与点击跳转、字符统计、阅读时间
- Markdown / TXT 导入，Markdown / HTML 导出
- 粘贴、拖拽或选择图片，按 `test.md` → `test.assets/` 保存，支持带图片 ZIP 导出
- 全文档 JSON 备份与合并恢复
- 打印 / 存为 PDF、专注模式、深浅主题、移动端布局
- 文档字体选择（默认宋体，另提供黑体、楷体、仿宋、系统默认），记住偏好并应用于 HTML 导出和打印
- GitHub 仓库 clone 地址导入、分支选择、拉取最新、审阅更改后提交并 push
- Go 后端、管理员用户管理、HTTPS 鉴权和加密存储

## Docker Compose 本地编译与部署

本机只需 Docker Engine / Docker Desktop 与 Compose v2，以及生成密钥所用的 OpenSSL；无需安装 Node、Go 或数据库。构建过程在多阶段 Dockerfile 中完成。当前默认使用 **HTTP**，后续可在自己的 Nginx 终止 HTTPS。

```sh
./scripts/setup-compose.sh
docker compose up -d --build
docker compose ps -a
```

打开 **http://localhost:8080**。初始用户名默认 `admin`，初始密码在本机文件中读取：

```sh
cat .secrets/admin_password
```

初始化脚本生成随机主密钥、PostgreSQL 管理员密码、应用数据库密码、初始应用管理员密码；不使用固定默认密码，不输出密码。`.secrets/` 和 `.env` 已忽略，不会进入 Git 或镜像构建上下文。目录权限为 0700；文件可读以便非 root 容器读取挂载，宿主机其他用户不能遍历该目录。重复运行脚本会保留已有密钥，`init` 只在没有用户时创建首个管理员，不会重置已有账号。

Compose 包含以下服务：

| 服务 | 用途 |
| --- | --- |
| `app` | Go 后端与编译后的前端，同源访问，默认映射 `127.0.0.1:8080` |
| `db` | PostgreSQL 17，数据库放在 `postgres_data` 命名卷，不向宿主机开放数据库端口 |
| `init` | 一次性初始化管理员；等待数据库健康后执行，成功后应用才启动 |
| `test` | 可选测试 profile，在独立临时 schema 中执行 PostgreSQL 后端测试 |

当前业务没有 Redis、消息队列等中间件依赖。账号、会话、文档和 Git 凭据全部在 PostgreSQL 内加密保存；应用使用独立的非超级用户数据库账号。未配置额外主机数据库或外部中间件。

常用操作：

```sh
docker compose logs --tail=100 app init
docker compose up -d --build             # 修改代码后重新编译并部署
docker compose restart app              # 仅重启服务
docker compose down                     # 停止并保留数据库卷
# PostgreSQL 集成测试（不读取或修改现有用户数据）：
docker compose --profile test run --rm --build test
```

不要使用 `docker compose down -v` 删除数据库卷，除非确实需要清空数据。数据库备份与 `.secrets/master_key` 必须分别保管；只有数据库备份无法解密内容。

### 地址与后续 Nginx 接入

`.env` 的 `APP_ORIGIN` 必须与浏览器使用的完整来源一致，末尾不带 `/`。如果使用 `http://127.0.0.1:8080`，就把该值改为相同地址；修改端口时同时修改 `APP_PORT` 和 `APP_ORIGIN`。默认仅本机可访问。

本地 HTTP 需显式设置 `ALLOW_HTTP=true`；此时 Cookie 使用普通名称并关闭 Secure，继续保留 HttpOnly、SameSite 和 CSRF 校验，不发送 HSTS。**HTTP 不提供传输加密**，数据库中的加密存储仍然有效。

后续 Nginx 配置参考 [deploy/nginx.conf.example](deploy/nginx.conf.example)。Nginx 在同一宿主机代理至 `127.0.0.1:8080`，保留 Compose 的回环地址绑定，并设置：

```dotenv
APP_ORIGIN=https://notes.example.com
ALLOW_HTTP=false
# 填实际代理到达容器时的源地址 /32，不要照抄未知网段：
TRUSTED_PROXY_CIDR=实际代理源IP/32
```

宿主机 Nginx 经过 Docker 端口映射时，源地址通常是容器网络网关，可查看：

```sh
docker inspect "$(docker compose ps -q app)" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
docker compose up -d
```

HTTPS 模式只信任配置代理来源的 `X-Forwarded-Proto: https`，会启用 Secure Cookie 与 HSTS。反向代理必须覆盖该请求头。无需在 Go 容器内配置证书。不要将 HTTPS 模式的应用端口改为公网绑定后信任 Docker 网关，否则远程请求可能共享同一 NAT 来源。

### 数据库备份与旧版迁移

```sh
mkdir -p backups
chmod 700 backups
# 生成 PostgreSQL 自洽的加密数据备份，输出文件自行保管：
docker compose exec -T db pg_dump -U postgres -d mkdocsweb -Fc > backups/mkdocsweb.dump
chmod 600 backups/mkdocsweb.dump
```

恢复应在新建的空数据库上使用 `pg_restore`，核对内容后再切换，避免覆盖现有数据。PostgreSQL 的数据库超级用户密码与应用账号密码分别在 `.secrets/postgres_admin_password`、`.secrets/postgres_password`；直接修改文件不会自动更改现有数据库角色密码。

旧版 bbolt 不会自动混入 PostgreSQL。如果有旧数据，先停止旧服务，使用**旧数据库原有的主密钥**替换 `.secrets/master_key`，在运行 `init` 前将旧库只读挂载到容器，执行 `migrate-bbolt`。该命令需设置 `LEGACY_DATA_FILE`，要求目标数据库没有用户、会话、文档或凭据，完整解密验证后在单个事务中重新加密写入；失败会回滚，不修改源库。先在副本上迁移并保留旧库和密钥。

### 开发检查

前端本地检查需要 Node.js 24+，Go 检查需要 Go 1.26.11+：

```sh
npm ci
npm test
npm run build
cd backend
go test -race ./...
go vet ./...
```

`npm run dev` 只是前端开发预览。完整登录、保存请使用 Compose 服务。GitHub Pages 无法运行此后端，工作流只做前后端检查；之前发布的旧 Pages 可在 GitHub Settings → Pages 中取消发布。

### 存储与接口安全

- 业务 API 均要求服务端会话。登录接口通过账号密码认证，是建立会话的必要入口；页面静态资源允许加载，但不包含用户数据。本地部署按配置允许 HTTP；启用 Nginx HTTPS 后应关闭 `ALLOW_HTTP`。
- HTTPS Cookie 使用 `__Host-` 前缀、Secure；HTTP Cookie 使用普通名称且不设置 Secure。两种模式均使用 HttpOnly、SameSite=Strict，服务端只保存随机会话 ID 的哈希；会话空闲 30 分钟、最长 8 小时。密码使用 Argon2id（64 MiB、2 轮、2 路）加盐哈希，不可解密。
- 写接口要求同源 Origin 和 CSRF 令牌。接口绑定页面所登录的用户 ID，防止同浏览器其他标签页切换账号后将旧用户文档保存到新账号。无跨域 CORS 授权。
- Compose 默认使用 PostgreSQL 事务数据库；文档、仓库连接、Git 令牌、账号和会话记录均使用 AES-256-GCM 加密保存，随机 nonce，并把记录类型和所属用户绑定到附加认证数据。Git 凭据索引使用独立派生密钥的 HMAC。Git 令牌仅后端解密使用，不返回浏览器；用户可删除已存令牌。
- API 从已验证会话确定所属用户，管理员只能管理账号，不能通过 API 查看其他用户文档或令牌。服务器持有主密钥，拥有服务器和密钥的人仍有解密能力；这不是端到端加密。
- 账号停用、权限变更、密码修改或重置会撤销该用户所有会话。登录有来源地址限速（10 次 / 10 分钟；反向代理模式共享代理地址额度）。不记录请求正文、密码和令牌。
- Git 代理仅允许固定 `api.github.com` 的必要 Git API 路径，拒绝重定向、任意目标 URL 和强制推送。服务端另有 64 MiB 请求/响应保护，非文档数量限制；超大工作区需分批拆分。

`MASTER_KEY` 必须与数据库分别保管并安全备份；丢失密钥无法恢复，密钥不匹配或加密记录被篡改时会拒绝解密，不会新建空数据覆盖。PostgreSQL 使用事务和数据库级写锁保护版本与账号修改，可与管理员 CLI 同时连接；兼容的旧版 bbolt 仍使用独占文件锁。请使用 PostgreSQL 备份工具，并单独备份密钥。密钥轮换需安排解密重加密迁移，不能直接更换环境变量。

## GitHub 仓库工作流

1. 点击左下角 **GitHub 仓库**，输入 `https://github.com/用户名/仓库.git` 或 `git@github.com:用户名/仓库.git`；可指定分支，留空使用仓库默认分支。
2. 公开仓库可不填令牌导入；私有仓库和 push 需在页面中填写 GitHub 访问令牌。建议使用仅授权目标仓库的 fine-grained token，仓库权限 **Contents: Read and write**；无需把令牌发给聊天助手。
3. 导入时只读取目录，完成后即可在以仓库名命名的根文件夹中浏览文件；点击文档时才下载正文，已打开内容自动缓存，刷新后可复用。目录层级和原始 `.md`、`.markdown`、`.txt` 扩展名保留。编辑、创建、移动、重命名或删除仓库文件夹内的文档即可产生更改。
4. 再次打开 **GitHub 仓库**，选择对应连接，点击 **检查更改**。清单区分新增、修改、删除，展开可查看原文及本次提交内容。
5. 填写提交说明，点击 **提交并 push**。文档和新增图片一起生成一次提交，图片使用二进制 blob，其他文件通过原始 Git tree 保留，不进行强制推送。
6. 没有本地更改时可点击 **拉取最新**；存在未提交改动时会拒绝覆盖。远端已有新提交时 push 会停止，请导出本地备份后在最新版本上手动合并。

这是前端通过 Go 后端代理 GitHub REST Git API 实现的文档 checkout/commit/push 工作流，不执行系统 `git clone`。SSH 地址用于识别仓库，浏览器不会读取本机 SSH 密钥；认证仍使用页面中填写的令牌。支持 `github.com` 已初始化且有提交的仓库，不包含 GitHub Enterprise、子模块文档、符号链接或自动合并冲突。受保护分支可能拒绝直接 push，可连接可写分支后在 GitHub 创建 PR。

令牌通过本站接口发送到后端并加密保存（本地 HTTP，配置 Nginx 后 HTTPS），只有当前账号可使用；之后可留空沿用。在仓库面板填写令牌后执行导入、拉取或 push 时保存。点击「删除已存令牌」可删除该账号对该仓库保存的令牌。令牌不进入 localStorage、JSON 文档备份、URL 或日志。仓库目录和已读取文档随当前账号工作区加密存储。导出的 JSON/Markdown/HTML 是明文文件，请自行保管。

已取消原先 300 份文档、单份 2 MB、总计 8 MB 的导入限制，正文要求 UTF-8。导入只读取仓库元信息和目录树，文档数量增加不会导致逐篇下载；打开文件时按固定版本读取，并合并同一文件的重复读取请求。文件树被 GitHub 截断时会停止导入。实际可导入规模仍取决于 GitHub API 限制、网络和浏览器内存；工作区保存和 Git API 代理单次请求/响应保护上限为 64 MiB，超过时会明确报错，请导出备份并拆分工作区。GitHub API 配额用尽、网络故障、令牌权限不足时页面会提示；未认证请求通常配额较低，可填写令牌后重试。全文搜索仅覆盖文件名及已缓存的正文；未打开文档的正文尚未下载，不参与正文搜索。未打开文件的改名、移动沿用原始 Git blob，删除仅移除对应路径，不会将未加载内容当成空白提交。跨仓库移动的未打开文件需先打开，再提交。拉取时以文件 SHA 判断缓存是否仍有效。Git 不跟踪空文件夹，空目录不会提交。富文本编辑可能规范化 Markdown 格式，请在更改预览中审阅后提交。

## 图片与同级 assets 目录

文档 `docs/test.md` 对应图片目录 `docs/test.assets/`，Markdown 引用示例：

```markdown
![图片](test.assets/image-时间戳-唯一编号.png)
```

- 点击「插入图片」或工具栏图片按钮，也可直接粘贴、拖拽图片。支持 PNG、JPEG、GIF、WebP，单张最大 20 MiB。文件名自动添加唯一编号，避免覆盖已有图片。
- 应用中的图片随工作区加密保存至 PostgreSQL，读取图片也需要当前用户会话。图片 URL 不包含访问令牌，跨用户不能读取。
- Git 导入会记录图片元信息，读取时通过当前账号的 Git 凭据按固定 blob SHA 获取，并加密缓存。新上传图片在审阅后与 Markdown 一起 push，仓库中实际生成文档同级的 `.assets` 目录。
- 新上传图片随所属文档移动；文档改名会同步更新这些图片的目录和 Markdown 引用。仓库中原有的其他图片和原有引用保持原样，不自动搬迁可能被多篇文档共享的远端图片。
- 普通 Markdown 导出仍是纯文本；请使用「导出 → 文档与图片 (.zip)」下载 Markdown 及对应 `.assets` 目录，解压后保持二者相对位置。JSON 备份也包含上传图片；恢复时重映射所属文档。
- 导入本地文件夹时，会一并导入文档同级 `.assets` 目录内的图片。全文搜索和左侧文档树不列出二进制图片文件。

## 文件夹与文件树

左侧只显示图标和单行文件名，长标题按固定行宽省略，悬停可查看完整名称。列表不显示摘要、时间或数量。

- 点击「文件」右侧的新建文件夹图标创建目录；选中文件夹后创建的是子目录。
- 新建文档放入当前选中的文件夹；点击「文件」文字可回到根目录。
- 点击文件夹展开或收起，双击文件夹名称重命名。
- 拖动文档或文件夹到其他文件夹中移动；拖到「文件」栏可移回根目录。禁止把文件夹放进自身或后代目录。
- 「导入文件夹」按浏览器提供的相对路径保留层级，读取 `.md`、`.markdown`、`.txt`；支持情况取决于浏览器的目录选择能力。
- JSON 备份保留文件夹结构，恢复时合并并分配新 ID。

## 数据和当前边界

文档由 Go 后端保存，浏览器不会将新文档或令牌写入 localStorage。网络断开或版本冲突时，页面显示未保存并暂停自动保存；请导出备份后刷新，避免关闭页面丢失内存中的改动。新版本不会把旧浏览器文档自动归属于任意登录用户；升级前请在旧版导出 JSON，登录目标账号后使用「导出 → 恢复文档备份」迁移，再清理旧来源的浏览器站点数据。旧 localStorage 不会被静默删除。

首版支持常用 GFM 语法；暂不包含数学公式、Mermaid、实时协作。Markdown 与富文本转换可能规范化空白、列表等原始格式，复杂嵌入 HTML 不保证无损往返。PDF 通过浏览器打印生成。

编辑器关闭 TOAST UI 使用统计。页面会通过本站接口自动保存文档至后端；文档中的外部图片和链接仍由浏览器访问。字体使用系统字体，无需第三方字体服务。

写作区上方的「字体」可切换文档标题、正文和预览字体，代码保持等宽。字体外观取决于设备安装情况，缺少所选字体时使用对应字体栈回退；不下载或分发系统字体。Markdown 文件保存纯文本，不包含字体设置。

## 快捷键

在即时编辑区直接键入 Markdown，无需切换源码模式或点击工具栏：

| 输入方式 | 效果 |
| --- | --- |
| 行首 `#` 至 `######` + 空格 + 完整标题，再按回车 | 渲染一级至六级标题，并进入下一行正文 |
| 行首三个反引号（可接 `javascript` 等语言），按回车 | 开始代码块 |
| 代码块末尾另起一行输入三个反引号，按回车 | 结束代码块，继续正文 |
| 用单个反引号包裹文字 | 行内代码 |
| `**加粗**` / `*斜体*` / `~~删除线~~` | 对应文字样式 |
| 行首 `-`、`*`、`+`，再按空格 | 无序列表 |
| 行首 `1.`，再按空格 | 有序列表 |
| 行首 `>`，再按空格 | 引用 |
| 输入 `- [ ] ` / `- [x] ` | 未完成 / 已完成任务 |
| 行首 `---`，按回车 | 分隔线 |

标题输入时保留 `## 完整标题` 原文，完成后按回车才渲染；撤销可恢复完整原文。列表仍在标记后按空格触发。行内语法在输入结束标记后转换；刚转换后可按退格恢复原始语法。代码块中的 Markdown 保持原文。源码模式保持原始字符输入。以上规则针对键入操作，粘贴整篇 Markdown 请使用源码模式或导入文件。

| 快捷键 | 功能 |
| --- | --- |
| ⌘ / Ctrl + Shift + N | 新建文档 |
| ⌘ / Ctrl + K | 搜索文档 |
| ⌘ / Ctrl + S | 保存至服务器 |
| ⌘ / Ctrl + / | 切换源码模式 |
| ⌘ / Ctrl + B / I | 加粗 / 斜体 |
| Esc | 退出专注模式 |

## 技术与许可证

Go + PostgreSQL + TypeScript + Vite + [TOAST UI Editor](https://github.com/nhn/tui.editor) + [DOMPurify](https://github.com/cure53/DOMPurify) + [Lucide](https://lucide.dev/)。本项目使用 MIT 许可证，依赖保留各自许可证。

TOAST UI Editor 当前 npm 版本已标记为不再维护，首版使用其成熟的 Markdown / 富文本编辑能力，并通过 npm overrides 将其旧 DOMPurify 依赖统一至当前修复版本。锁文件固定经过验证的依赖；后续升级前需复测中文输入、Markdown 往返与粘贴清洗，长期迭代建议迁移至持续维护的编辑器内核。


## Flow 流程图

使用 `flow` 或 `flowchart` 代码围栏：

```flow
st=>start: 开始
op=>operation: 执行任务
cond=>condition: 是否完成？
e=>end: 结束

st->op->cond
cond(yes)->e
cond(no)->op
```

即时编辑和 Markdown 预览显示流程图；点击“编辑源码”后修改，再点击“预览流程图”。复制按钮复制原始代码，Markdown 保存和 Git 提交仍保留原文；HTML 导出包含内联 SVG，打印可输出当前图形。语法错误时会提示并保留源码。图形按可用宽度布局，空间不足时向下扩展，颜色跟随主题。

这是 flowchart.js 语法，和 Mermaid 不同。未包含定义或连线的内容无法渲染；独立文字行属于前一个节点的续行。渲染在浏览器本地完成，不向外部绘图服务发送文档。

流程图使用 ELK 正交自动布局减少连线穿过节点的情况。节点外框默认统一为 180×84，窄屏下同图节点统一收窄，保留判断、开始/结束、输入输出等语义形状。长文字最多显示两行，超出省略；悬停节点查看全文。源码、复制和 Markdown 导出保留完整文字，HTML 导出的 SVG 也包含完整文字提示。复杂图形中的连线交叉不一定能完全消除。

流程图默认填满写作区宽度，不需要横向滑动。原方向放不下时自动改为纵向布局，窄屏进一步收紧或分行，让图形向下延伸；调整窗口、切换侧栏或专注模式后会重新布局。
