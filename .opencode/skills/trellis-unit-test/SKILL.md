---
name: trellis-unit-test
description: "单元测试专家。在 check 阶段（trellis-check 之后）使用：依据 test/用例设计.md 分发 trellis-unit-test subagent 编写并执行单元测试，遵守最多两轮修复循环，测试脚本与报告留存到 {TASK_DIR}/test/unit/。Use when 代码已实现并通过 check、需要单元级测试验证时。"
---

# Trellis 单元测试（Unit Test）

在 check 阶段、`trellis-check` 之后加载本 skill。负责对本次代码变更执行单元级测试检查。

## 触发时机

- 当前任务状态：in_progress，Phase 2.2。
- `trellis-check`（spec 合规与自修复）已执行完毕。
- 接口测试（`trellis-api-test`）在单元测试之后执行。

## 前置检查

1. 确认用例设计存在：
   - 有 `{TASK_DIR}/test/用例设计.md` → 以其 UT 用例为准。
   - 无（轻量任务）→ 从 `prd.md` 验收标准现场推导单元用例，并在最终报告注明"用例为现场推导"。
2. 确认项目测试约定：读取 `.trellis/spec/` 中对应包/层的测试 spec（如 `unit-test/index.md`、`conventions.md`），测试脚本必须沿用项目现有框架与风格，不硬编码、不自创风格。

## 分发 subagent

通过 Task 工具分发 `trellis-unit-test` subagent：

- **Agent type**：`trellis-unit-test`
- **Dispatch prompt 首行必须是**：`Active task: <TASK_DIR>`（插件据此注入 test.jsonl / 用例设计 / prd/design/implement 上下文）
- 随后说明：你已是 `trellis-unit-test` subagent，直接执行单元测试两轮循环，不得再次分发任何 subagent。

## 两轮修复循环契约（subagent 执行）

```
Round 1: 依据用例设计编写测试脚本到 {TASK_DIR}/test/unit/ → 运行
         → 修复（测试脚本错误或产品代码缺陷均可自修）
         → 生成 {TASK_DIR}/test/unit/report-round-1.md
         全绿 → 结束（无 Round 2）

未全绿 → Round 2: 修复剩余失败 → 重跑
         → 生成 {TASK_DIR}/test/unit/report-round-2.md
         仍失败 → 停止，最终报告列明失败用例交回主会话，不再自行修复
```

报告格式（每轮，中文）：

```markdown
# 单元测试报告 Round N

## 执行信息
- 执行命令：<实际运行的测试命令>
- 用例总数：X｜通过：Y｜失败：Z

## 失败用例明细
| 用例ID | 期望 | 实际 | 原因/堆栈摘要 |

## 修复说明
- <文件:行>：改了什么 / 为什么

## 剩余失败
- （Round 2 且仍失败时列出，交回主会话）
```

## 主会话收尾校验

subagent 返回后，主会话核对：

- [ ] `{TASK_DIR}/test/unit/` 下测试脚本与报告齐全，报告按轮次命名
- [ ] 轮次 ≤ 2；两轮后失败已交回主会话且未继续自修
- [ ] 测试遵循项目约定（框架/命名/目录）
- [ ] 测试脚本本身无调试残留、无跳过整个测试套件的写法（`it.skip` / `describe.skip` 全量跳过）
- [ ] 通过或失败结果已纳入最终完成汇报

若发现 subagent 违规（超轮次、产物缺失、未交回失败），在汇报中明确指出并让主会话决策。

## 与原生 trellis-check 的关系

- `trellis-check`：spec 合规、自修复、lint/typecheck。
- 本 skill：补充测试覆盖验证，两者互补，顺序为 check → unit-test → api-test。
