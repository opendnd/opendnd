---
title: "ADR-008: Two-layer consistency checking"
description: Deterministic rules over the structured record first; an LLM scanner over prose that extracts claims and tests them against the record second.
---

**Status:** Accepted for layer one, proposed for layer two. 2026-09-03

## Context

A world accumulates facts from authors, generators and AI, over in-world centuries and years of authoring. Contradictions creep in: a character acts after their death, a battle predates the founding of the city it destroyed, a chronicle names the wrong king. Readers notice; tools rarely do. The ontology already makes facts structured and dated, which is what makes checking possible.

## Decision

**Layer one: rules over the record.** `checkHistory()` in `@opendnd/simulation` evaluates deterministic rules over people, relationships, events and tenures and returns findings that name the rule, the severity, the resources involved and a sentence a human can act on. It only reports contradictions the record proves; it never guesses. Rules today: no participation after death (death, widowing and succession in the death year excepted), death year agrees between event and record, parents alive and of plausible age at a birth, spouses alive at marriage, one holder per office at a time, holders alive during tenure, tenures end after they begin. Rules grow with the systems; every simulation run is checked before it returns.

**Layer two: an LLM scanner over prose.** Works (chronicles, legends, articles, session notes) are prose and cannot be checked by rules directly. The scanner reads a work, extracts claims as structured statements (subject, predicate, object, time, place, perspective), resolves the names against resources in the world, and tests each claim against the record and layer one. It produces findings of three kinds: contradiction (the prose says X, the record says not-X), unsupported (the prose asserts something the record has no trace of), and ambiguous (a name could be several people). Findings are recorded as out-of-universe `claim` resources held by the checker, so they appear in the Codex, can be dismissed with a reason, and are never silently applied. Legends and myths declared untrue in-world are exempt from contradiction findings by design: a `work` of type legend or myth may contradict the record, and the finding is downgraded to a note.

## Consequences

- The scanner runs through Bedrock like other AI features and is metered the same way. It never edits the record; humans resolve findings, which keeps canon decisions with authors.
- Rule findings during generation are bugs; rule findings over authored content are review items. The same code serves both.
- Claim extraction is the reusable piece: the same step will let the generation side ground AI-written prose in the record before it is saved.
