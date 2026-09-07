# Security Router

The skill library holds roughly 700 security procedures. No agent memorises them. The pattern is always the same: **`find-skills` for the engagement, match the family below to the specialist, then the specialist runs the specific procedure.**

Authorisation first — see agent 34 (`security-lead`). No offensive action without written scope.

---

## Family → agent

| Skill-name pattern | Owner | Count (approx) |
|---|---|---|
| `exploiting-*`, `attacking-*`, `conducting-*-penetration-test`, `performing-*-attack`, `operating-*-c2`, `building-*-c2`, `moving-laterally-*`, `coercing-*`, `bypassing-*`, `post-exploiting-*`, `relaying-*`, `escaping-containers-*` | `offensive-security-engineer` (35) | ~95 |
| `detecting-*` (as detection logic), `building-detection-*`, `implementing-siem-*`, `configuring-*-ids`, `building-soc-*`, `implementing-soar-*`, `performing-false-positive-*`, `implementing-alert-fatigue-*`, `triaging-security-alerts-*` | `detection-engineer` (37) | ~153 |
| `hunting-*`, `performing-threat-hunting-*`, `fleet-hunting-*` | `threat-hunter` (38) | ~55 |
| `analyzing-*` (malware/memory/disk/artifact), `reverse-engineering-*`, `performing-*-forensics`, `extracting-*`, `recovering-*`, `deobfuscating-*`, `investigating-*`, `containing-*`, `eradicating-*`, `triaging-windows-*`, `building-*-timeline`, `collecting-volatile-*`, `parsing-artifacts-*` | `dfir-analyst` (36) | ~95 |
| `analyzing-threat-*`, `building-threat-*`, `collecting-*-intelligence`, `profiling-threat-actor-*`, `tracking-threat-actor-*`, `mapping-mitre-*`, `monitoring-darkweb-*`, `performing-*-osint`, MISP/OpenCTI/STIX/TAXII | `threat-intel-analyst` (39) | ~50 |
| `auditing-*` (cloud/IAM/K8s), `securing-*` (cloud/container/serverless), `implementing-*` (cloud posture, K8s policy, zero-trust), `hardening-docker-*`, `scanning-*` (Trivy/Grype/kubesec), `enumerating-cloud-*`, `emulating-cloud-attacks-*` | `cloud-security-engineer` (40) | ~80 |
| `testing-*` (OWASP/API), `exploiting-*` (web/API classes), `performing-*-web-application-*`, `implementing-api-*`, `integrating-sast/dast-*`, `conducting-api-security-testing`, `performing-sca-*` | `appsec-engineer` (41) | ~75 |
| `implementing-*-compliance`, `implementing-iso/gdpr/hipaa/pci-*`, `conducting-*-risk-assessment`, `performing-*-audit-*`, `performing-nist-*`, `managing-third-party-vendor-risk`, `performing-access-review-*`, `performing-privacy-impact-*` | `grc-compliance-engineer` (42) | ~45 |
| `*-prompt-injection`, `*-model-poisoning`, `*-model-extraction`, `assessing-vector-*`, `securing-agentic-ai-*`, `testing-for-system-prompt-leakage`, `red-teaming-llms-*`, `orchestrating-llm-attacks-*`, `defending-llms-*`, `implementing-llm-guardrails-*`, `continuous-llm-red-teaming-*` | `ai-security-engineer` (43) | ~15 |
| `monitoring-scada-*`, `detecting-*` (SCADA/Modbus/DNP3/ICS/historian), `implementing-*` (Purdue/IEC-62443/NERC-CIP/OT), `securing-*-ot-*`, `performing-ot-*`, `performing-*-scada-*` | `ot-security-engineer` (44) | ~24 |
| Identity/zero-trust/crypto/vuln-mgmt implementation (`implementing-zero-trust-*`, `implementing-*-encryption`, `configuring-*-mfa`, `performing-vulnerability-scanning-*`, `prioritizing-vulnerabilities-*`) | nearest of `cloud-security-engineer` / `appsec-engineer` / `grc-compliance-engineer` by context | ~100 |

---

## Cross-cutting rules

**Authorisation gate.** Any `exploiting-*`, `attacking-*`, `performing-*-attack`, or C2 skill requires written scope recorded by `security-lead`. An agent that cannot see authorisation assumes none and stops.

**Isolation gate.** Any malware `analyzing-*` or `reverse-engineering-*` skill runs only in a confirmed-isolated environment. If isolation is unconfirmed → static analysis only.

**OT safety gate.** Any active OT skill (`performing-ot-*`, `performing-scada-*`) needs process-engineer sign-off and prefers a test bench over live equipment. Passive first, always.

**Find, don't memorise.** `find-skills <keywords>` resolves the exact procedure. The library changes; this router maps families, not every leaf.
