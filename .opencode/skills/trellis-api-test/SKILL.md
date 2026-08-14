---
name: trellis-api-test
description: "接口测试专家。在 check 阶段（trellis-unit-test 之后）使用：依据 test/用例设计.md 分发 trellis-api-test subagent 编写并执行接口测试，遵守最多两轮修复循环，测试脚本与报告留存到 {TASK_DIR}/test/api/。Use when 代码已实现并通过 check、需要接口级测试验证时。"
---

# Trellis 接口测试（API Test）

在 check 阶段、`trellis-unit-test` 之后加载本 skill。负责对本次代码变更执行接口级测试检查。

## 触发时机

- 当前任务状态：in_progress，Phase 2.2。
- `trellis-check` 与 `trellis-unit-test` 已执行完毕。

## 接口的定义范围

"接口"按任务实际暴露面取其一或组合（由 `test/用例设计.md` 的 IT 用例定义）：

- HTTP/RPC API（端点、方法、参数、状态码、响应结构）
- CLI 命令接口（子命令、flag、stdin/stdout/stderr、退出码）
- 模块公共 API（导出函数/类方法的跨模块调用契约）

## 前置检查

1. 确认用例设计存在：
   - 有 `{TASK_DIR}/test/用例设计.md` 且含 IT 用例 → 以其为准。
   - 用例设计标注"接口不适用"→ 本 skill 可跳过，向主会话说明理由。
   - 无用例设计 → 从 `prd.md` 验收标准 + `design.md` 接口契约现场推导 IT 用例。
2. 确认项目既有接口测试约定（`test/` 目录、`integration-patterns.md` 等 spec）；沿用项目现成工具（测试框架 / curl / httpx / 项目内建测试工具），不自创。

## 分发 subagent

通过 Task 工具分发 `trellis-api-test` subagent：

- **Agent type**：`trellis-api-test`
- **Dispatch prompt 首行必须是**：`Active task: <TASK_DIR>`（插件据此注入 test.jsonl / 用例设计 / prd/design/implement 上下文）
- 随后说明：你已是 `trellis-api-test` subagent，直接执行接口测试两轮循环，不得再次分发任何 subagent。

## 两轮修复循环契约（subagent 执行）

```
Round 1: 依据用例设计编写接口测试脚本到 {TASK_DIR}/test/api/ → 运行
         → 修复（测试脚本错误或产品代码缺陷均可自修）
         → 生成 {TASK_DIR}/test/api/report-round-1.md
         全绿 → 结束（无 Round 2）

未全绿 → Round 2: 修复剩余失败 → 重跑
         → 生成 {TASK_DIR}/test/api/report-round-2.md
         仍失败 → 停止，最终报告列明失败用例交回主会话，不再自行修复
```

报告格式（每轮，中文）：

```markdown
# 接口测试报告 Round N

## 执行信息
- 执行命令：<实际运行的测试命令>
- 用例总数：X｜通过：Y｜失败：Z

## 失败用例明细
| 用例ID | 接口 | 期望 | 实际 | 原因/堆栈摘要 |

## 修复说明
- <文件:行>：改了什么 / 为什么

## 剩余失败
- （Round 2 且仍失败时列出，交回主会话）
```

## 主会话收尾校验

subagent 返回后，主会话核对：

- [ ] `{TASK_DIR}/test/api/` 下测试脚本与报告齐全，报告按轮次命名
- [ ] 轮次 ≤ 2；两轮后失败已交回主会话且未继续自修
- [ ] 测试遵循项目约定（框架/命名/目录）
- [ ] 测试环境处理得当（服务起停、mock 外部依赖、测试后清理），无遗留进程/资源
- [ ] 测试脚本本身无调试残留、无跳过整个测试套件的写法

若发现 subagent 违规（超轮次、产物缺失、未交回失败），在汇报中明确指出并让主会话决策。

## 与单元测试的关系

- 单元测试（`trellis-unit-test`）：函数/模块内部行为。
- 接口测试（本 skill）：对外契约与端到端路径。
- 顺序：check → unit-test → api-test。
