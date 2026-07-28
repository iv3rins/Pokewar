# Task for reviewer

只读审查本轮实际修改：apps/web/src/styles.css、tests/e2e/pve-tutorial.spec.ts、apps/server/src/config/config.ts、apps/server/src/index.ts、apps/server/src/scheduler/{deadlineStore.ts,redisDeadlineStore.ts,*test.ts}、apps/server/src/storage/indexedRoomStore.test.ts、scripts/deploy-debian12.sh、docs/DEPLOYMENT_DEBIAN12.md、.env.example、.prettierignore。重点找布局回归、deadline 边界正确性、Debian 12 脚本可重复执行/安全/语法问题。不要修改文件，按严重性反馈。

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