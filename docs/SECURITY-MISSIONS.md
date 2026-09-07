# Security Mission Templates

Security engagements. `security-lead` (34) is the lead session; the others are teammates.

**Authorisation is the first line of every offensive mission.** No scope, no mission.

---

## S1 — Web application penetration test (3 teammates)

```text
AUTHORISED pentest of [app]. Scope: [exact domains/IPs]. Window: [dates].
Authorisation on file from [name/role]. Rules of engagement: [permitted/forbidden].

Spawn:
- appsec-engineer, named "app" — OWASP web+API, authorisation flaws by hand
- offensive-security-engineer, named "offense" — exploitation chains within scope only
- security-lead, named "lead" — enforces scope, owns the client report

offense re-reads scope before each new target. Nothing outside it.
No real data exfiltration — prove access, don't copy it.
Findings: reproduction, severity with justification, business impact, fix.
```

## S2 — Incident response (4 teammates)

```text
Suspected incident: [what was observed, when, which systems].

Spawn:
- dfir-analyst, named "dfir" — acquire evidence (hash first), build the timeline
- threat-hunter, named "hunt" — scope the blast radius across other systems
- detection-engineer, named "detect" — turn confirmed TTPs into detections
- security-lead, named "lead" — coordinates containment decisions

dfir preserves before analysing. Malware only in isolation.
Build the timeline before theorising. Confirmed vs inferred, labelled.
If an active ongoing intrusion is confirmed, lead decides containment before hunting continues.
```

## S3 — Cloud security assessment (3 teammates)

```text
Assess [AWS/Azure/GCP account/subscription]. Read-only credentials provided.

Spawn:
- cloud-security-engineer, named "cloud" — posture, IAM least-privilege, misconfig
- appsec-engineer, named "app" — the app/cloud boundary
- security-lead, named "lead" — report

Misconfiguration over exploitation. IAM first. Name the blast radius per finding.
```

## S4 — Detection engineering sprint (2-3 teammates)

```text
Improve detection coverage for [technique/threat/ATT&CK tactic].

Spawn:
- threat-hunter, named "hunt" — hunt the gap, hand confirmed TTPs over
- detection-engineer, named "detect" — build rules mapped to ATT&CK, tune FP rate

Every detection maps to a technique and ships with a playbook and a stated FP rate.
```

## S5 — AI/LLM security review (2 teammates)

```text
Security review of [our AI feature / agent / RAG pipeline].

Spawn:
- ai-security-engineer, named "aisec" — injection surfaces, guardrail red-team, tool-abuse
- appsec-engineer, named "app" — the API and auth around it

Map every path where external content reaches a prompt or tool call.
Test guardrails with garak/pyrit/promptfoo — don't assume them.
State residual risk honestly; prompt injection has no complete fix today.
```

## S6 — Compliance readiness (2 teammates)

```text
Prepare for [ISO 27001 / SOC 2 / PCI-DSS / HIPAA / GDPR].

Spawn:
- grc-compliance-engineer, named "grc" — gap assessment, control mapping, evidence
- security-lead, named "lead" — scope boundary and business-risk translation

A paper control is a finding, not a pass. Verify implementation.
Map once, satisfy many — find the framework overlap.
```

## S7 — Threat intelligence brief (1-2 teammates)

```text
Who is targeting [us / our sector], and what should we do about it?

Spawn:
- threat-intel-analyst, named "intel" — actor profiling, campaign analysis, MITRE mapping

Source reliability and confidence on every assessment.
Observation vs assessment vs speculation, labelled. Date everything.
Lead with the "so what" for us, not a threat encyclopedia.
```

---

## Gate reference

| Gate | Applies to | Rule |
|---|---|---|
| Authorisation | S1, and any offensive skill | Written scope on file, or stop |
| Isolation | S2 malware work | Isolated env, or static-only |
| OT safety | any OT engagement | Process-engineer sign-off, passive first |
| Least privilege | S3 | Read-only creds unless scope says otherwise |
