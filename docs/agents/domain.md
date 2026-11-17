# Domain Docs

This repository uses a single-context layout.

## Before exploring

Read the root `GLOSSARY.md` and any ADRs under `docs/adr/`
that concern the area being explored.

If these files do not exist, proceed silently.
The domain-modeling skill creates them when terminology or decisions
are resolved; do not create empty placeholders during setup.

## Layout

- `GLOSSARY.md`: shared domain terminology.
- `docs/adr/NNNN-short-title.md`: architectural decision records.

## Vocabulary

Use the glossary's terms in issue titles, proposals, hypotheses,
and tests. Follow its guidance on synonyms.

If a needed concept is absent, reconsider whether it belongs to the
domain; record real terminology gaps for domain-modeling.

## ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR,
including the ADR identifier and why the decision should be reopened.
