# Task for planner

[Read from: D:\iverins_workspace\game\pokewar-final\context.md]

为全新 Debian 12 root 服务器（1 vCPU/1GB RAM，域名 game.n1komajor.top，源码 https://github.com/iv3rins/Pokewar.git main）设计 Docker Compose + Caddy + Node server + PostgreSQL + Redis 的一键部署方案。要求首次安装、更新、回滚、每日备份7天、恢复、UFW、Fail2ban、Swap、最小端口。只读规划，不编辑。结合仓库配置与环境变量给出文件清单和关键命令。

---
**Output:**
Return the complete artifact in your final response.
The runtime will persist it to exactly this path: D:\iverins_workspace\game\pokewar-final\.pi-subagents\artifacts\outputs\a4192eec\parallel-0\2-planner\plan.md
Do not call contact_supervisor merely because no write-capable tool is available.
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```