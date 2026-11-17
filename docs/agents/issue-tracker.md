# Issue tracker: GitHub

Issues and specs live at:
https://github.com/ZeeJune1112/codex-dsh-pet/issues

Use the `gh` CLI from this repository directory.

## Target verification

Before the first issue creation in a session, run:
`gh repo view --json nameWithOwner`

The target must be `ZeeJune1112/codex-dsh-pet`.
Resolve any mismatch with the user before publishing.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open --json number,title,body,labels,assignees`
  Add `--label` and `--state` filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`
- Edit body: `gh issue edit <number> --body-file <file>`
- Apply labels: `gh issue edit <number> --add-label "..."`
- Remove labels: `gh issue edit <number> --remove-label "..."`
- Close: post an explanation as a comment, then `gh issue close <number>`.

Use a UTF-8 file for multiline bodies and comments.
Use `triage-labels.md` for the triage role strings.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the referenced issue.

## Parent issues and dependencies

Use native GitHub sub-issues:
`gh issue create --parent <parent> ...`

If sub-issues are unavailable, put `Part of #<parent>` in the child
and add the child to a task list in the parent.

Use native blocking dependencies:
`gh issue edit <child> --add-blocked-by <blocker>`

If dependencies are unavailable, put `Blocked by: #<n>, #<n>` near
the top of the child body. A ticket is unblocked when all blockers
are closed.

For native dependencies, count open blockers with:
`gh api repos/ZeeJune1112/codex-dsh-pet/issues/<number> --jq .issue_dependencies_summary.blocked_by`

## Pull requests as a triage surface

PRs as a request surface: no.

GitHub issues and pull requests share one number space.
When a bare number is ambiguous, resolve it with `gh pr view <number>`
and fall back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child ticket: a sub-issue of the map, labelled `wayfinder:<type>`,
  where type is `research`, `prototype`, `grilling`, or `task`.
  Use the parent-link fallback above when necessary.
- Frontier: select open children with no open blockers and no assignee;
  first in map order wins.
- Claim: assign the ticket to the current user with
  `gh issue edit <number> --add-assignee @me` before starting work.
- Resolve: comment with the answer, close the ticket, then append a
  brief finding and ticket link to the map's Decisions-so-far section.

Create required wayfinding labels when that workflow is first used.
