---
name: if-llm
description: Assess an in-app AI/LLM task and produce a plan. Use when the user wants the app to use AI or an LLM to classify, score, tag, extract, summarise, or otherwise process text or records.
---

The user wants the app to use an LLM to process something. Their input:

$ARGUMENTS

- If the input is empty, ask what they want the AI to do, and to what data.
- If it describes a task ("sort these into categories", "score each one", "pull the fields out of this text", "summarise each"), use that as the target.
- If it's freeform prose, parse out the task and the data shape — ask if it's ambiguous.

Then read `.claude/skills/if-llm/assessment.md` and follow it exactly.

It is **assessment only**: work the checks, land on an implementation type, write `llm-plan.md` to the project root, present the verdict to the user in plain language, then **stop**. Do not write the LLM code in this phase.
</content>
