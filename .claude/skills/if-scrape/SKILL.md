---
name: if-scrape
description: Assess a website for scraping and produce a plan. Use when the user wants to scrape, watch, monitor, or pull data from a web page or site.
---

The user wants to assess a website for scraping. Their input:

$ARGUMENTS

- If the input is empty, ask which URL they want to assess.
- If it contains a URL or domain, use that as the target.
- If it's freeform prose, parse the target URL out of it — ask if it's ambiguous.

Then read `.claude/skills/if-scrape/assessment.md` and follow it exactly.

It is **assessment only**: work the decision tree, land on an implementation type, write `scrape-plan.md` to the project root, present the verdict to the user in plain language, then **stop**. Do not write scraping code in this phase.
