#!/usr/bin/env python3
"""Capture screenshots of a running page at multiple viewports and scroll positions.

Closes the visual feedback loop: agents write UI code they cannot see. This produces
images an agent can actually look at and critique, instead of shipping blind.

Inputs:  --url http://localhost:5173  [--out .tmp/shots] [--scroll 0,50,100]
         [--viewports mobile,desktop] [--dark]
Outputs: PNG files + a JSON manifest on stdout
COST:    free (local Playwright, no API calls)

Requires: pip install playwright && playwright install chromium
"""

import argparse, json, os, sys

VIEWPORTS = {
    "mobile":  (390, 844),
    "tablet":  (834, 1112),
    "desktop": (1440, 900),
    "wide":    (1920, 1080),
}


def capture(url, out_dir, viewports, scroll_pcts, dark):
    from playwright.sync_api import sync_playwright

    os.makedirs(out_dir, exist_ok=True)
    shots = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for vp_name in viewports:
            w, h = VIEWPORTS[vp_name]
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=2,
                color_scheme="dark" if dark else "light",
            )
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(600)  # let entrance animations settle

            height = page.evaluate("document.body.scrollHeight")
            for pct in scroll_pcts:
                y = int((height - h) * pct / 100) if height > h else 0
                page.evaluate(f"window.scrollTo(0, {y})")
                page.wait_for_timeout(500)  # let scroll-triggered motion resolve
                name = f"{vp_name}_{pct:03d}.png"
                path = os.path.join(out_dir, name)
                page.screenshot(path=path)
                shots.append({"viewport": vp_name, "size": f"{w}x{h}",
                              "scroll_pct": pct, "path": path})
            ctx.close()
        browser.close()

    return shots


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default=".tmp/shots")
    ap.add_argument("--viewports", default="mobile,desktop")
    ap.add_argument("--scroll", default="0,50,100")
    ap.add_argument("--dark", action="store_true")
    a = ap.parse_args()

    vps = [v.strip() for v in a.viewports.split(",") if v.strip() in VIEWPORTS]
    if not vps:
        print(f"error: no valid viewports. choose from {list(VIEWPORTS)}", file=sys.stderr)
        return 1
    try:
        pcts = [int(s) for s in a.scroll.split(",")]
    except ValueError:
        print("error: --scroll must be comma-separated integers", file=sys.stderr)
        return 1

    try:
        shots = capture(a.url, a.out, vps, pcts, a.dark)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("hint: is the dev server running at that URL?", file=sys.stderr)
        return 1

    print(json.dumps({"url": a.url, "count": len(shots), "shots": shots}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
