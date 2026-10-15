# v0.1.0 实现说明

> 历史基线。v0.2 已改变默认导出策略、文件格式、确认门禁与覆盖规则；当前使用方式见 [第一轮迭代报告](07-v02-iteration-report.md) 和 README。

## 1. 运行流程

```text
上传/本地只读扫描
  → 文件范围、格式、字节数和路径检查
  → 尽力脱敏的分析输入
  → TypeScript AST 或 Java 词法适配
  → 当前入口静态展开 + 证据索引
  → Ajv Schema 和跨对象引用校验
  → 通用工作台 / CLI 单文件 HTML
```

原始内容只用于本机计算摘要与证据行范围；展示片段和提取表达式来自脱敏输入。不使用 LLM，也不依赖运行输入工程。

## 2. 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/safety.js` | 路径、扩展名、大小限制、脱敏、只读目录扫描 |
| `src/parsers.js` | AST/词法适配；内部符号、参数、调用、条件、纯表达式 |
| `src/analyzer.js` | 入口、有限静态展开、节点、证据、未解析项 |
| `src/model.js` + `schema/` | Ajv 验证、唯一 ID、引用、原文件摘要和范围一致性 |
| `public/simulation.js` | 无工具权限的纯声明式投影、样例、diff、别名血缘 |
| `public/app.js` | 通用页面交互；所有源码/模型文本用 textContent |
| `src/export.js` | 合成独立 HTML，不需要 CDN、服务器或 ES Module 加载 |
| `src/evidence.js` | 核对当前磁盘源码，区分 valid/stale/missing |
| `src/server.js` | 仅 loopback 服务与受限 API，上传内容不落盘 |
| `src/cli.js` | 只读分析与导出，拒绝向源码目录写产物 |

## 3. 实际 JSON 契约

`schemaVersion = 1.0.0`，正式 Schema 在 `schema/analysis.schema.json`。

- `project`：标题、语言。
- `sourceSnapshot`：稳定快照 ID、相对文件路径、内容 SHA-256、大小、行数。
- `entries`：发现的函数/方法；`entryStepId` 为当前选择。
- `entities`：服务节点，以及基于命名推断的外部/存储/队列提示节点。
- `steps`：参数、受限转换、条件、事务注解线索、证据引用、解析器标识。
- `flows`：源码中的调用表达式；`resolution` 区分同文件静态匹配、声明引用和未解析。
- `contracts`：发现的字段、类型及声明证据。
- `evidence`：原始行号/文件摘要/片段摘要、脱敏展示摘录及状态。
- `diagnostics`、`report`：支持范围、未解析项、限额与分析边界。
- `presentation`：固定装配布局、静态展开回放、暗色主题。
- `dataMode`：此版本固定为 `mock`，不能用 observed 模式输出。

本版没有 `scenarios`、持久化快照模型、事务区域生成或受验证的失败恢复路径。初始草案中的这些能力仍在路线图中。

### 静态匹配说明

- 同文件按名字与有限词法作用域匹配，参数/局部变量遮蔽时保守保留未知。
- JS/TS 仅支持显式相对命名导入，不读取额外磁盘文件，不解析 npm 包或 tsconfig 路径别名。
- Java 按简单字段声明类型与唯一方法名匹配；重载和多候选不选一个猜测答案。
- 不保证类型正确、可编译、可达、运行时绑定或完整调用关系。
- 循环引用保留边，步骤最多 40 个；其他调用与函数可在诊断或入口列表查看。

## 4. 受限数据投影

允许 `literal`、`ref`、`object`、`array`、`unknown`。声明式规则由解析器构造，不允许模型提交自定义代码或 SQL。

- 仅提取 JS/TS 的直线不可变 const 与 return。
- 遇到复杂控制流、可变声明、副作用语句、未知初始化表达式后，不继续声称输出已计算。
- 方法调用、算术、日期计算、spread、解构、getter 行为等不执行。
- 数据来源是按类型构造的占位值或用户手工输入，不来自真实 HTTP 请求。
- 每个步骤独立构造入参，不做跨步骤运行环境传递。
- 字段 diff 是输入形态与选定投影比较；removed 展示为“未包含”，不代表删除数据库字段。

## 5. 本地 HTTP API

仅限本地工具集成，不是稳定公网服务 API。

| 方法/路径 | 内容 |
| --- | --- |
| `GET /api/config` | 当前本机 session token 和大小限制 |
| `GET /api/demo/typescript` | 自建订单样例及分析结果 |
| `GET /api/demo/java` | 自建 Java 样例及分析结果 |
| `POST /api/analyze` | `{files: [{name, content}], entry?, name?}` → 模型 |
| `POST /api/export` | `{model}` → 独立 HTML |

POST 要求 JSON、`X-Studio-Token` 和同源 Origin（如请求携带）。Host 必须为 loopback。浏览器不暴露“读取任意本地路径”的 API。

限额：120 个文件、每文件 200 KB、源码总量 2 MB、请求体 6 MB、800 个发现函数、40 个展开步骤。超限应缩小模块，不静默截断文件。

## 6. 导出与分享

CLI 生成 `index.html`、`analysis.json`、`report.json`。浏览器导出 JSON 和单文件 HTML。独立 HTML 使用固定可信渲染代码与转义后的惰性 JSON，不加载模块/网络资源；重新分析需回到本机服务。

**导出包含源码摘录。** 当前没有“无源码分享包”按钮；不要误以为文件忽略或脱敏能自动授予公开权限。公开 Pages 工作流只使用自建合成夹具。

## 7. 与最初方案的取舍

- 为降低安装和离线导出的复杂度，本版使用原生 ES Modules，未采用 React/Vite。
- 使用 TypeScript AST 和有限 Java 词法适配，暂未引入 JavaParser 进程。
- 先交付可验证的本地事实 → 通用页面闭环，而非从模型生成任意 HTML。
- 草稿原 Demo 的数据库电影与恢复分支未自动迁移；否则容易把人工配置误称为自动分析结果。

这些是明确的版本边界，不是隐藏的待实现占位按钮。
