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

**`/freeze` does not compose. It writes ONE path to ONE global file (`~/.gstack/freeze-dir.txt`), read by a PreToolUse hook across every session on the machine.** A second implementer running `/freeze` overwrites the first one's boundary and silently removes their protection. Discovered the hard way in Phase 2, when a second implementer was instructed to freeze while another held the slot; they correctly refused and reported it instead of running it.

So:

- **The lead assigns the freeze slot to at most ONE implementer** — the one touching the most contested or most destructive surface. Say so explicitly in the spawn prompt.
- **Every other implementer works to a self-imposed boundary** stated in its spawn prompt, and is told the slot is already taken and by whom.
- **An implementer told to freeze when the slot is occupied must NOT run it.** Refuse, keep the self-imposed boundary, and message the lead and the holder. Overwriting someone's live boundary to satisfy a stale instruction is worse than having no boundary.
- Check the current holder with `cat ~/.gstack/freeze-dir.txt` before assuming the slot is free.

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
