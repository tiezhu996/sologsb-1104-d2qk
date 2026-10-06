# 榫卯结构拆解图鉴

面向传统木作学习者与家具设计人员的纯前端单页应用。项目把榫卯类型、构件尺寸、配合公差、拆装步骤、内联 SVG 示意图与适用家具整理为一套可查询、可编排、可追溯的本地图鉴，所有数据均保存在当前浏览器中。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

服务启动后访问：`http://localhost:21804`

停止服务：

```bash
docker compose down
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| UI | React 18、TypeScript 5 |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 路由 | React Router 6 |
| 状态 | Zustand 4 |
| 本地数据 | Dexie 4、IndexedDB |
| 容器 | Docker 多阶段构建、Nginx |

## 访问地址

- 宿主机端口：`21804`
- 页面地址：`http://localhost:21804`
- 前端路由回退由 Nginx 的 `try_files` 规则处理。

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

类型检查与生产构建：

```bash
cd frontend
npm run build
```

本地开发默认使用 Vite 的 `5173` 端口；应用数据由浏览器中的 Dexie 数据库维护，不需要后端服务。

## 目录结构

```text
.
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/common/   共享 SVG、步骤轨道、尺寸字段和标签
│   │   ├── hooks/               步序编排与 SVG 热区解析
│   │   ├── pages/               图鉴、详情、步序、绘制台与家具反查
│   │   ├── router/              前端路由
│   │   ├── stores/              Zustand 状态与数据落库
│   │   ├── types/               核心数据模型
│   │   ├── utils/               Dexie、尺寸换算与 JSON 导出
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## 数据存储说明

应用使用 IndexedDB，数据库封装库为 Dexie 4，库名为 `gbmortise-db`。

- `version(1)`：建立 `joints`、`members`、`steps`、`diagrams`、`furniture` 五张表及查询索引。
- `version(2)`：执行升级迁移，为五张表回填 `schemaRev = 2` 字段。
- `version(3)`：步骤新增构件关联（`memberId`）、前置关系（`prereqIds`）、起始步标记（`isStart`）与老师例外（`exception`）。迁移**不会**为旧步骤虚构前置，缺少前置/构件的旧步骤在装配计划中进入“待补关系”，补齐前不可执行。
- 首次创建数据库时通过 Dexie `populate` 回调写入榫卯、构件、步骤、内联 SVG 与家具关联的种子数据。
- 新建记录、尺寸修改、SVG 保存、步骤关联与拖拽调序都会实时写回 IndexedDB，刷新页面后仍可读取。

## 装配计划与校验规则

步序编排把“步序 + 类型详情 + 导出”接成一份装配计划：每个步骤关联构件与前置，并带方向与工具。校验在页面与导出中使用同一套规则（`src/utils/assemblyPlan.ts`）：

| 阻挡 | 类型 | 说明 |
| --- | --- | --- |
| 前置成环 | 硬阻挡 | 沿前置链回到自身，环上节点均不可标为可执行，且拖动会被直接拒绝 |
| 缺前置 / 缺构件 | 硬阻挡 | 进入“待补关系”，起始步（`isStart`）允许无前置 |
| 悬空前置 / 构件已删除 | 硬阻挡 | 引用目标不存在，需重新指定 |
| 前置倒置 | 软阻挡（可例外） | 前置步骤排在本步骤之后 |
| 方向互锁 | 软阻挡（可例外） | 同一构件上重复沿同一方向装入 |
| 工具同抢 | 软阻挡（可例外） | 同一构件上无前后依赖的步骤占用冲突工具（木槌/橡胶锤互斥） |

- 老师例外只能豁免三类软阻挡；硬阻挡不可放行。例外依据带内容签名，关联的构件、前置、方向、工具一旦修改即失效。
- 校验失败（如成环）时，步骤顺序与例外状态整体回滚到改动前，并在页面顶部写清阻挡原因。
- “导出装配计划”输出每个步骤的构件、前置、方向、工具、可执行状态、例外状态与逐条阻挡原因，以及待补关系与汇总计数。

## 核心功能与路由表

| 路由 | 页面 | 核心功能 |
| --- | --- | --- |
| `/` | 入口重定向 | 自动进入榫卯图鉴 |
| `/joints` | 榫卯图鉴总览 | 按家族与难度分组，新建类型，显示构件数与步骤数，导出全部数据 |
| `/joints/:id` | 类型详情 | 查看尺寸表、公差校验、适用家具与步骤；导出当前类型 |
| `/joints/:id/steps` | 装配计划编排 | 关联构件与前置、设置方向与工具，拖拽调序并做环/方向/工具校验，处理老师例外与计划导出 |
| `/joints/:id/diagram` | 示意图绘制台 | 点击热区回填构件，编辑构件名称、尺寸与 SVG 源 |
| `/furniture` | 家具榫卯反查 | 按家具聚合使用部位与承力说明，新建家具关联 |
