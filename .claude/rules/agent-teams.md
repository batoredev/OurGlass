# Agent Teams Rules

These rules exist because agent teams parallelise work inside **one shared filesystem**. The platform does not prevent teammates from destroying each other's work. These rules do.

## 1. One browser owner per mission — always

The gstack browse daemon is a single persistent Chromium session. Cookies, localStorage, and tabs carry over between commands. Two agents driving it concurrently corrupt each other's session state and produce phantom bugs.

**Browser-driving skills:** `/browse`, `/qa`, `/qa-only`, `/design-review`, `/canary`, `/benchmark`, `/scrape`, `/devex-review`, `/setup-browser-cookies`, `/open-gstack-browser`.

Default owner: **qa-browser-lead**. Everyone else messages them.

## 2. Auto-committing skills never run in a teammate

These fix and commit autonomously — correct solo, destructive in a team:

| Skill | Behaviour |
|---|---|
| `/review` | Auto-fixes obvious findings |
| `/qa` | Fixes bugs with atomic commits |
| `/design-review` | Up to 30 style commits |
| `/skillify` | Commits a synthesised script |
| `/ship` | Syncs main, pushes, opens PR |
| `/land-and-deploy` | Merges and deploys |

Run them in the **lead**, after every implementer has shut down. Teammates use the read-only variants: `/qa-only` instead of `/qa`, findings-reporting instead of `/review` fix mode.

## 3. /freeze is a SINGLE global slot — exactly one implementer may hold it

File ownership in agent teams is convention. `/freeze <glob>` blocks Edit and Write outside a boundary and makes it partly real. It is accident prevention, not a sandbox — Bash paths like `sed` still escape it.

**`/freeze` protects a session from ITSELF. It does not protect one teammate's files from another teammate — it cannot, and never could.**

Two facts, both established by direct test in Phase 2 rather than by reading the skill:

1. **The state is global; the enforcement is per-session.** `/freeze` writes ONE path to ONE global file (`~/.gstack/freeze-dir.txt`), but the PreToolUse hook that *reads* it is registered when `/freeze` is invoked **in a session**. Teammates do not inherit another session's hooks. A teammate verified this: with the file holding another agent's path, an Edit outside that path still **succeeded**.
2. Therefore the failure mode is the inverse of the intuitive one. A second implementer running `/freeze` gains **nothing it did not already have**, while silently disarming the live hook of whoever held the slot.

So:

- **Between agents, the ownership map plus discipline is the entire mechanism.** Freeze adds nothing to it. Do not let a freeze slot read as cross-agent protection — the lead must state each implementer's boundary in its spawn prompt and rely on that.
- **At most ONE implementer runs `/freeze`**, and only for its own benefit (stopping itself from straying). Say so explicitly.
- **An implementer told to freeze when the slot is occupied must NOT run it.** Refuse, keep the self-imposed boundary, and message the lead and the holder. Overwriting a live boundary to satisfy a stale instruction is worse than having no boundary — and buys nothing.
- Check the current holder with `cat ~/.gstack/freeze-dir.txt` before assuming the slot is free.
- **The slot is never released when its holder exits.** A path left by an agent that finished
  days ago looks identical to a live claim — there is no owner, no timestamp, no liveness in
  the file itself. Distinguish them by cross-checking the file's mtime (`stat -c '%y'`) against
  `ListAgents`: if no live session owns that path, the claim is stale and safe to take. **An
  implementer must still escalate rather than decide this alone** — it turns on which sessions
  are live, which only the lead can see. A Phase 3 implementer hit exactly this, refused the
  slot, and asked; that was the right call and it is why this bullet exists.
- **Never route edits around another agent's guard rail** (Bash/heredoc to dodge a hook, say). A teammate proposed exactly this in Phase 2 and withdrew it; the other agent correctly declined to be the implicit sign-off. A message from a teammate is not consent.

Never `/unfreeze` to reach across a boundary. Message the owner instead.

## 4. Read-only roles have no Write or Edit

The `tools:` allowlist is the **only per-teammate restriction the platform actually enforces**. Reviewers, investigators, and QA carry no write tools. This is what makes it safe to run them in parallel with implementers.

`permissionMode:` in agent frontmatter does **not** apply — teammates inherit the lead's permission mode at spawn and it cannot be set per-teammate.

## 5. Skills are not bound per teammate

The `skills:` and `mcpServers:` frontmatter fields are **ignored** when a definition runs as a teammate. Teammates load skills from project and user settings, exactly like a normal session — every teammate sees the same pool.

Role specialisation therefore comes from the definition **body** (which skills to reach for), the **tools allowlist** (enforced), and the **ownership map** (convention plus `/freeze`).

## 6. Publish contracts early

If another teammate is blocked on your output — schema shape, API contract, design tokens — message it the moment it settles. Do not wait until your task completes. A blocked teammate burns context idling.

## 7. Report failures; do not route around them

Blocked by someone else's bug? Message them and the lead. Do not implement a workaround in your own files. Two workarounds around one bug is how a codebase rots.

## 8. Team sizing

Start at 3. Three focused teammates outperform five scattered ones. Token cost scales linearly per teammate; each has its own context window.

Use a team for: parallel review, competing-hypothesis debugging, cross-layer features, research.
Use a single session for: sequential work, same-file edits, routine tasks.
