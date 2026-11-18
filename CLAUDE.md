# CLAUDE.md

## Reference repos (read-only)

`aws-emulator/` and `api-models-aws/` are other people's GitHub repos, cloned here for reference only. Read them to understand the emulator and the Smithy models. Never edit, build into, commit or open PRs or issues against them. The console's own code lives outside them.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `Nulliqent/emulator-utility`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Agent workflow for code changes

Every code-change task runs up to six subagents. Pass `model` explicitly on each Agent call, and `effort` where one is given.

0. **UI/UX designer** (`model: sonnet`). Runs only when the task touches a service or page that has no UI in the design (`AWS Emulator Console — UI Design.html` / `AWS Emulator Console — UI Design Spec.md`). Designs that page to match the existing design system and the model-driven view conventions in the console plan, and hands the design to the implementer.
1. **Implementer** (`model: sonnet`, `effort: medium`). Makes the code changes.
2. **User simulator** (`model: sonnet`, `effort: medium`). Acts as a real user. Runs the change and interacts with it, for example by driving the console UI or calling the emulator through the Gateway. Reports what works, what breaks and what is confusing.
3. **Code reviewer** (`model: opus`, `effort: medium`). Reviews the quality of the changed code: correctness, maintainability, module boundaries, tests.
4. **Security reviewer** (`model: opus`, `effort: medium`). Reviews the security of the changed code, for example credential handling, the Gateway proxy and origin checks, the Docker socket, and input validation.

5. **Committer** (`model: sonnet`, `effort: medium`). Runs only after 2, 3 and 4 all pass. Creates a branch for the ticket off `main`, commits the change with a message that references the ticket, pushes, and opens a pull request whose body says `Closes #<ticket>`. It does not merge unless the user says to. It reports the PR link so the next ticket can start.

Run 0 first when it applies, then 1. Run 2, 3 and 4 after 1 finishes; they can run in parallel. Send any findings from 2–4 back to the implementer, then re-check. Run 5 last, once every review is clean.

### Moving to the next ticket

When the committer starts, the orchestrating session (the main conversation that spawns these subagents) checks whether the next ticket is ready to start, and if it is, starts its workflow at once, concurrently with the committer. Do not wait for the PR to merge.

- A ticket is ready when each of its blockers is either closed, or has a PR open from a committer. Use the ticket order and the blocking links in the tracker (see `docs/agents/issue-tracker.md`).
- If a blocker's PR is still open, branch the new ticket from that PR's branch, not from `main`, and say so in the new PR.
- Run each ticket's subagents in its own git worktree (`isolation: "worktree"`), so concurrent tickets never touch the same working tree.
- If no ticket is ready, or the next one is `ready-for-human`, stop and tell the user.

### Saving progress

Save progress so work survives a network disconnect, a crash or a usage limit. A **progress saver** subagent (`model: sonnet`, `effort: medium`) does the saving. The orchestrating session spawns it:

- **periodically**: after every workflow step finishes for any ticket (implementer done, reviews back, PR opened), and at least every 30 minutes while tickets are in flight;
- **immediately**: when a usage-limit warning appears, or a subagent stops because of a limit or a network error.

The progress saver:

1. In each in-flight ticket's worktree, commits the uncommitted work with a `wip(#<ticket>): <step>` message and pushes it. On the first save it renames the worktree's branch to `ticket/<n>-<slug>`. Never merge WIP into `main`. It never stages secrets, `.aws/`, `node_modules`, build output, or the reference repos.
2. Comments on each in-flight ticket: the workflow step it reached (designer, implementer, user simulator, reviewers or committer), what is done, what is left, any open review findings, the branch and the worktree path.
3. Rewrites `PROGRESS.md` in the main checkout's root (git-ignored, local only) with one line per in-flight ticket (ticket, step, branch, worktree, next action), the PRs that are open, and the ticket frontier.

Implementers also make their own `wip(#<ticket>):` commits at natural checkpoints, without pushing. The progress saver pushes them. The committer squashes the WIP commits into one ticket commit before opening the PR.

To resume, read `PROGRESS.md` and the ticket comments, check out each ticket's branch, and restart the workflow from the recorded step.
