# Why your frontend isn't showcase-grade — and how to fix it

If output looks competent but not like the sites in the demos, there are six causes. Four are fixable in this pack, one is a stack problem, and one is a mismatch you may actually want.

---

## 1. You're comparing against edited highlights

Those clips are the best result of many attempts, usually a 15-second hero rather than a working product, often hand-finished after recording, and frequently a rebuild of an award-winning site the model has seen thousands of times.

Not a reason to lower ambition — a reason to expect **iteration**, not one-shot output. The people producing that work run twenty passes. So should you.

## 2. The distinctive part came from a human

AI executed; a person with taste decided. An Awwwards-grade site is weeks of design work. The AI part is the fast part.

`taste-director` narrows the field and kills generic defaults. It does not originate an identity. That remains yours.

## 3. The libraries aren't installed ← most concrete cause

**Skills are instructions. They don't install packages.** No agent will write Three.js if `three` isn't in `package.json` — it writes a CSS transition, because that's what's available.

```bash
# 3D
npm i three @react-three/fiber @react-three/drei
npm i @react-three/postprocessing postprocessing

# Scroll choreography — the biggest single lever for "premium" feel
npm i gsap lenis

# Text reveals
npm i split-type

# Physics (optional)
npm i @react-three/rapier
```

`gsap` includes ScrollTrigger and has been free for most commercial use since v3.12. `lenis` is what makes scroll-linked motion feel smooth rather than jittery — most "why does theirs feel better" comes down to this.

Then tell `CLAUDE.md` they exist, or agents won't know:

```markdown
## Creative stack available
three + @react-three/fiber + drei · gsap with ScrollTrigger · lenis · split-type
Use these for hero and marketing surfaces. Not in the admin console.
```

## 4. No visual feedback loop ← biggest quality lever

Every agent writes UI **it cannot see**. A designer looks, winces, adjusts — twenty times. Agents ship the first attempt blind.

`tools/visual_capture.py` fixes this. It screenshots the running page at multiple viewports and scroll positions; `visual-critic` (agent 33) reads the PNGs and critiques them like a designer would, then hands findings back for another pass.

```bash
pip install playwright && playwright install chromium
npm run dev
python3 tools/visual_capture.py --url http://localhost:5173 \
  --viewports mobile,desktop --scroll 0,25,50,75,100
```

**Two to three critique rounds is normal.** A first pass needing no changes means the critic wasn't looking hard enough.

## 5. Description instead of reference

"Make it premium" is unactionable and produces the mean of everything the model has seen.

Create `docs/design/REFERENCES.md`:

```markdown
## Sites we're aiming at
- <url> — the scroll-pinned product reveal, specifically the pinning behaviour
- <url> — type scale and the generous whitespace between sections
- <url> — cursor interaction, the magnetic buttons

## What we are NOT
- Not a gradient-hero SaaS template
- Not card-grid-everything
- Not purple-to-blue

## Feeling
Three adjectives. Be specific: "precise, quiet, confident" beats "modern, clean".
```

Naming behaviours you want beats describing feelings. Point at the mechanism, not the vibe.

## 6. Some of the gap is correct

PSS is an operational tool 2,000 students use daily. Awwwards motion on it would be **actively bad** — that's exactly why `taste-director` sets low variance for daily-use interfaces.

Showcase aesthetics belong on landing pages, marketing sites, and first-impression surfaces. Applying them to an admin console makes the tool worse. Decide which surface you're building before asking for more visual ambition.

---

## The fix, in order

| # | Do | Why |
|---|---|---|
| 1 | Install the creative libraries | Nothing else matters if they're absent |
| 2 | `pip install playwright && playwright install chromium` | Enables the feedback loop |
| 3 | Write `docs/design/REFERENCES.md` | Turns "premium" into something actionable |
| 4 | Add the creative stack to `CLAUDE.md` | Agents don't know what they don't see |
| 5 | Run **Mission 4c** | The iteration loop, below |
| 6 | Expect 3+ rounds | One-shot showcase output is not a thing |

---

## Mission 4c — Showcase-grade interface (4 teammates)

For landing pages, marketing sites, and hero surfaces. **Not for admin tools.**

```text
Create an agent team to bring [surface] to showcase quality.
References are in docs/design/REFERENCES.md. Read them first.

Spawn four teammates:
- taste-director, named "taste" — set variance HIGH for this surface, state the
  direction and what it must NOT look like. Advises only, owns nothing.
- creative-web-engineer, named "creative", owning src/scenes/** and src/effects/**
  — verify the required libraries exist BEFORE planning. Report missing ones.
- design-engineer, named "de", owning src/components/** and token files
- visual-critic, named "eye" — read-only. Runs tools/visual_capture.py and reads
  the PNGs. Critiques what was actually rendered, not the code.

Sequencing:
- taste publishes direction before anyone builds
- creative reports missing libraries to me before implementing
- after the first build, eye captures and critiques, then creative and de fix
- REPEAT the capture-critique-fix loop at least twice more

Do not stop at the first working version. The first version is the draft.
State the performance budget: 60fps mid-range laptop, defined mobile fallback.
```

The repeat instruction is the point. Without it the team ships the draft.

---

## What still won't happen

You won't get a distinctive visual identity from this. You'll get **well-executed, technically capable, reference-matched** work — which is most of the distance, and enough for client sites.

The last stretch, the thing that makes a site recognisably *yours*, is a human decision. This system holds a line very well. It doesn't draw the line.
