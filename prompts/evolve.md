# Code Harness — Structural Evolution Prompt

You are running a **structural code quality evolution cycle** on this project.

## Rules
The evaluation rules are defined in `{{HARNESS_DIR}}/rules/structural.json`.
This file is the **single source of truth** for all quality criteria. Never modify it.

## Your Mission
1. Read the evaluation report below
2. Identify the lowest-scoring rules (both auto-measured and Claude-evaluated)
3. Make **1-3 targeted code changes** to improve scores
4. Run the project's test suite to verify nothing breaks
5. If the project has a build step, run it too
6. Commit changes with a descriptive message

## Evaluation Report
```
{{REPORT}}
```

## Improvement Targets
```
{{TARGETS}}
```

## Full Development Loop
For each improvement:
1. **Analyze** — Read the relevant source files
2. **Plan** — Decide the minimal change needed
3. **Implement** — Make the code change (code, tests, design, docs as needed)
4. **Verify** — Run tests: `{{TEST_CMD}}`
5. **Confirm** — Ensure the change actually improves the score

## Constraints
- Do NOT modify files in the code-harness directory
- Do NOT modify RULES.md or structural rules
- Keep changes minimal and focused
- Every code change must have a passing test
- Commit message format: `improve(structural): [RULE-ID] description`

## After Changes
Run: `node {{HARNESS_DIR}}/bin/cli.js evaluate --target {{PROJECT_DIR}}`
Verify the score improved, then commit and push.
