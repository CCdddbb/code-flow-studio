# Code Flow Studio

**让代码里的数据旅程，看得见。**

Local-first, evidence-backed visualization for Java, JavaScript and TypeScript. Upload source, explore a static flow outline, inspect field mappings, and export a standalone interactive page.

> v0.1.0 是可运行的静态分析与可视化项目，不是任意代码执行器。它区分源码事实、命名推断与模拟投影；无法解析的行为保留为未知。

![接入装配工作台](docs/images/studio-desktop.png)

## 功能

- **导入代码**：多文件、文件夹、拖放或粘贴片段；也可通过 CLI 分析本地模块。
- **入口选择**：发现函数与方法，按选定入口展开有限静态调用关系。
- **接入装配台**：输入契约 → 当前逻辑 → 依赖交接，支持逐步播放、定位、速度和重置。
- **数据工作台**：编辑演示 JSON，观察支持的 copy / rename / literal / object / array 投影。
- **字段血缘与差异**：追溯局部 const 别名，比较输入与输出对象的形态。
- **源码证据**：相对路径、原始行号、SHA-256、尽力脱敏的代码摘录与诊断。
- **独立导出**：JSON、质量报告、单文件 HTML；HTML 可双击离线打开。
- **本地优先**：不调用外部 AI、不执行源码、不连接业务数据库。

## 快速开始

需要 **Node.js 22+**。

```bash
npm ci
npm start
```

打开 **http://127.0.0.1:4174**。页面默认展示订单合成示例；左侧可切换 Java 草稿示例，或点击「导入你的代码」。

端口占用时：

```bash
PORT=4180 npm start
```

PowerShell：`$env:PORT=4180; npm start`。

### 体验数据变化

1. 在订单示例中点击「下一步」，选择 `toEnvelope`。
2. 切到「数据变化」，修改 `input.customer` 或 `input.amount`，点击「应用修改」。
3. 核对返回对象、字段血缘、结构差异与源码证据。
4. 点击「导出页面」，下载独立 HTML。

每个步骤独立使用自己的演示入参；系统**不假装自动执行调用链或传递真实运行值**。

## 命令行生成

```bash
npm run analyze -- fixtures/typescript --out artifacts/order
npm run analyze -- fixtures/java --entry DraftService.submit --out artifacts/java
npm run analyze -- /path/to/module --entry MyService.submit --out /path/to/output
```

输出：

```text
index.html      # 独立交互页面，双击可打开
analysis.json   # 可校验的中间模型与证据
report.json     # 覆盖情况、未解析项与限制
```

`--entry` 支持符号名或唯一 ID；同名入口须使用 ID。`--name` 可指定展示名称。输出目录必须在源码目录之外。分析不运行输入工程的构建/安装脚本。

### 证据是否陈旧

```bash
npm run evidence -- fixtures/typescript artifacts/order/analysis.json
```

返回 `valid` / `stale` / `missing`；陈旧或缺失时退出码为 1。校验不会修改源码或静默更新证据。源码变更后需要重新分析。

## 支持范围

| 能力 | v0.1.0 |
| --- | --- |
| JS/TS 解析 | TypeScript AST；函数、方法、接口/类型字面量、调用表达式、if 条件 |
| JS/TS 引用解析 | 同文件可见命名函数、this 方法、相对路径显式命名导入 |
| Java 解析 | 有限词法适配；public/protected/private 方法、字段、简单 record、注解线索 |
| Java 引用解析 | 简单字段声明类型的唯一方法匹配；**不证明 Spring 运行时绑定** |
| 自动样例 | 已发现字段的类型占位值；未知类型需手工补充 |
| 受限模拟 | JS/TS 直线 const/return 的对象、数组、引用、字面量投影 |
| 条件/重试/事务 | 展示条件与注解，不执行分支，不证明恢复/幂等/事务传播 |
| 数据库存储 | 调用命名提示，标记 inferred；**不生成真实表结构或持久化快照** |
| 整仓库/其他语言 | 尚未支持；推荐限定模块与入口 |

调用图是**静态展开**，包含条件内的调用；播放顺序不是执行顺序。复杂控制流、有副作用语句、未知计算会阻断后续模拟或返回 `$unknown`。unknown 不等于 null、失败、空表或回滚。

Java 示例刻意保留外部接口，不能编译或代表完整业务应用；它用于检验分析边界。所有公开示例为本项目新写的合成代码，未复制原业务仓库。

## 测试

```bash
npm run verify                 # 语法 + Schema + Node 单元/集成测试
npx playwright install chromium
npm run test:browser           # 真实浏览器回归（生成 artifacts/ 截图）
npm audit
```

macOS 有 Google Chrome 时自动使用；其他已有浏览器可通过 `CHROME_PATH` 指定。首次安装 Chromium 需要网络。

当前本地验收：**36 个 Node 测试 + 12 项浏览器检查通过**。包括上传、JSON 修改、字段血缘、Java 边界、离线导出、脚本注入防护和 390px 窄屏。详见 [交付与迭代记录](docs/04-delivery-report.md)。GitHub CI 已配置，但需推送后才会实际运行。

## 项目结构

```text
src/             分析器、解析适配、模型校验、本地服务、CLI、导出、证据核验
public/          通用装配台、数据工作台、纯投影引擎、响应式样式
schema/          JSON Schema v1
fixtures/        自建 Java / TypeScript 示例
tests/           Node 与 Playwright 回归
scripts/         语法检查
docs/            方案、实际模型说明、交付报告、公开截图
.github/         CI 与可手动启用的 Pages 演示部署
```

架构：`代码 → 静态事实/证据 → 校验模型 → 受限模拟 → 通用页面`。浏览器 UI 使用原生 ES Modules，无框架或远程 CDN；分析使用 TypeScript 与 Ajv。

- [实际模型与 API](docs/05-implementation.md)
- [产品迭代计划（v0.1.0 → v1.0）](docs/06-product-iteration-plan.md)
- [初始方案](docs/01-project-plan.md) / [契约草案](docs/02-analysis-contract.md) / [历史迭代路线](docs/03-iteration-backlog.md)
- [贡献指南](CONTRIBUTING.md) / [安全说明](SECURITY.md)

## 上传 GitHub

公开前确认没有私有源码、真实分析产物、密钥和连接配置。`node_modules/`、`artifacts/`、本地源码等已忽略。

```bash
git init -b main
git add .
git diff --cached --stat
# 人工审查暂存内容后：
git commit -m "Initial Code Flow Studio release"
git remote add origin https://github.com/YOUR_USERNAME/code-flow-studio.git
git push -u origin main
```

可选 GitHub Pages：在仓库 Settings → Pages 中选择 **GitHub Actions**，手动运行 `Publish synthetic demo to Pages`。它只发布自建订单示例的离线页；**Pages 不提供上传分析服务**，新代码分析仍需本地 `npm start`。

本项目未自动创建远程仓库或上传任何文件。

## 后续方向

- 完整 Java AST/符号解析，更多框架适配。
- 带证据与人工确认的场景分支、状态机、事务/跨库投影。
- 可选模型辅助归纳及布局选择，保留本地无模型模式。
- 更多语言与独立业务基准，不把草稿示例硬编码成所有输入的答案。

## License

[MIT](LICENSE)。许可证仅覆盖本项目代码和自建示例；不授予用户输入源码的公开权利。
