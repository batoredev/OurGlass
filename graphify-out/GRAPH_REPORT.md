# Graph Report - OurGlass  (2026-09-07)

## Corpus Check
- 125 files · ~61,009 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 271 nodes · 252 edges · 32 communities (19 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- apps/web package config
- packages/db package config
- apps/api package config
- root package config
- apps/web tsconfig
- packages/evals package config
- packages/shared package config
- tsconfig.base.json
- packages/evals tsconfig
- apps/api tsconfig
- apps/web devDependencies
- packages/db tsconfig
- packages/shared tsconfig
- apps/api npm scripts
- apps/api Fastify server
- apps/web npm scripts
- root npm scripts
- tools/_template.py
- packages/shared entry point
- tools/visual_capture.py
- task-completed-gate hook
- teammate-idle-gate hook
- tool-cost-guard hook
- packages/db entry point

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `compilerOptions` - 16 edges
3. `scripts` - 7 edges
4. `scripts` - 7 edges
5. `scripts` - 7 edges
6. `buildServer()` - 4 edges
7. `scripts` - 4 edges
8. `scripts` - 4 edges
9. `compilerOptions` - 4 edges
10. `scripts` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (32 total, 5 thin omitted)

### Community 0 - "apps/web package config"
Cohesion: 0.07
Nodes (22): metadata, config, nextConfig, dependencies, next, @ourglass/shared, react, react-dom (+14 more)

### Community 1 - "packages/db package config"
Cohesion: 0.08
Nodes (24): dependencies, @ourglass/shared, pg, devDependencies, @types/node, @types/pg, typescript, vitest (+16 more)

### Community 2 - "apps/api package config"
Cohesion: 0.08
Nodes (23): dependencies, @anthropic-ai/sdk, fastify, @ourglass/shared, pg, devDependencies, tsx, @types/node (+15 more)

### Community 3 - "root package config"
Cohesion: 0.09
Nodes (21): description, devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest (+13 more)

### Community 4 - "apps/web tsconfig"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 5 - "packages/evals package config"
Cohesion: 0.11
Nodes (18): dependencies, @ourglass/shared, devDependencies, @types/node, typescript, vitest, @ourglass/shared, @types/node (+10 more)

### Community 6 - "packages/shared package config"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, exports, typescript, vitest, main, name (+8 more)

### Community 7 - "tsconfig.base.json"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 8 - "packages/evals tsconfig"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, ../../tsconfig.base.json, references

### Community 9 - "apps/api tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references

### Community 10 - "apps/web devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, eslint, eslint-config-next, @types/node, @types/react, @types/react-dom, typescript, vitest

### Community 11 - "packages/db tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references

### Community 12 - "packages/shared tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, composite, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 13 - "apps/api npm scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, start, test, test:integration, typecheck

### Community 14 - "apps/api Fastify server"
Cohesion: 0.43
Nodes (3): buildServer(), main(), fastify

### Community 15 - "apps/web npm scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, start, test, typecheck

### Community 16 - "root npm scripts"
Cohesion: 0.29
Nodes (7): scripts, build, build:libs, dev, lint, test, typecheck

### Community 17 - "tools/_template.py"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 19 - "tools/visual_capture.py"
Cohesion: 0.67
Nodes (3): capture(), main(), Capture screenshots of a running page at multiple viewports and scroll…

## Knowledge Gaps
- **193 isolated node(s):** `task-completed-gate.sh script`, `teammate-idle-gate.sh script`, `tool-cost-guard.sh script`, `name`, `version` (+188 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 212 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `apps/web devDependencies` to `apps/web package config`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `scripts` connect `apps/web npm scripts` to `apps/web package config`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `scripts` connect `apps/api npm scripts` to `apps/api package config`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `task-completed-gate.sh script`, `teammate-idle-gate.sh script`, `tool-cost-guard.sh script` to the rest of the system?**
  _193 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `apps/web package config` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `packages/db package config` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `apps/api package config` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._