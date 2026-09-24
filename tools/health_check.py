"""Poll an OurGlass deployment's /api/health until it reports a live database.

Needs: a base URL (no token — /api/health is deliberately unauthenticated so a
monitor can reach it).
COST: free. No model call, no metered quota.

WHY THIS EXISTS: the same retry-and-check-for-"db":true loop was written twice
on 2026-09-24, once in the deploy workflow's smoke step and once in the uptime
workflow, and a third time in prose in docs/RUNBOOK.md. The graph made the
duplication visible (three nodes, one behaviour), and .claude/rules/wat.md §7
says that is a tool waiting to be written. Both workflows now call this.

Exit 0 when the deployment answers with a database connection, 1 otherwise.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def probe(url: str, timeout: float) -> tuple[bool, str]:
    """One attempt. Returns (healthy, what to print)."""
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/health", timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return False, f"HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 — any transport failure is "not healthy yet"
        return False, f"{type(error).__name__}: {error}"

    try:
        payload = json.loads(body)
    except ValueError:
        return False, f"not JSON: {body[:200]}"

    # `db` is the part that matters: a Worker can serve while its database is
    # unreachable, and that is precisely the outage worth catching.
    return payload.get("db") is True, body[:200]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        required=True,
        help="Base URL of the deployment, e.g. https://ourglass.example.workers.dev",
    )
    parser.add_argument("--attempts", type=int, default=5, help="Attempts before failing (default 5)")
    parser.add_argument("--delay", type=float, default=6.0, help="Seconds between attempts (default 6)")
    parser.add_argument("--timeout", type=float, default=15.0, help="Per-request timeout in seconds (default 15)")
    parser.add_argument("--label", default="deployment", help="Name used in messages, e.g. staging")
    args = parser.parse_args()

    for attempt in range(1, args.attempts + 1):
        healthy, detail = probe(args.url, args.timeout)
        if healthy:
            print(f"{args.label} healthy: {detail}")
            return 0
        print(f"{args.label} attempt {attempt}/{args.attempts}: {detail}", file=sys.stderr)
        # No sleep after the last attempt — it would only delay the failure.
        if attempt < args.attempts:
            time.sleep(args.delay)

    print(
        f"::error title={args.label} is unhealthy::{args.url}/api/health did not report a "
        f"database connection. docs/RUNBOOK.md has the recovery steps.",
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
