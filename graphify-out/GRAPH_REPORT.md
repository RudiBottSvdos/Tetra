# Graph Report - .  (2026-10-05)

## Corpus Check
- Corpus is ~2,011 words - fits in a single context window. You may not need a graph.

## Summary
- 85 nodes · 78 edges · 19 communities (16 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10

## God Nodes (most connected - your core abstractions)
1. `scripts` - 10 edges
2. `useDb()` - 4 edges
3. `createAuth()` - 3 edges
4. `@nuxt/ui` - 2 edges
5. `better-auth` - 2 edges
6. `drizzle-orm` - 2 edges
7. `nuxt` - 2 edges
8. `postgres` - 2 edges
9. `tailwindcss` - 2 edges
10. `vue` - 2 edges

## Surprising Connections (you probably didn't know these)
- `createAuth()` --calls--> `useDb()`  [EXTRACTED]
  server/utils/auth.ts → server/db/index.ts

## Import Cycles
- None detected.

## Communities (19 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (17): better-auth, drizzle-orm, nuxt, @nuxt/ui, dependencies, better-auth, drizzle-orm, nuxt (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.15
Nodes (13): drizzle-kit, happy-dom, @nuxt/test-utils, devDependencies, drizzle-kit, happy-dom, @nuxt/test-utils, typescript (+5 more)

### Community 2 - "Community 2"
Cohesion: 0.20
Nodes (10): scripts, build, db:generate, db:migrate, dev, generate, postinstall, preview (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.33
Nodes (4): error, loading, mode, state

### Community 4 - "Community 4"
Cohesion: 0.60
Nodes (4): createDb(), useDb(), createAuth(), useAuth()

### Community 5 - "Community 5"
Cohesion: 0.60
Nodes (4): account, session, user, verification

### Community 6 - "Community 6"
Cohesion: 0.40
Nodes (4): "account", "session", "user", "verification"

### Community 7 - "Community 7"
Cohesion: 0.50
Nodes (3): name, private, type

## Knowledge Gaps
- **38 isolated node(s):** `authClient`, `session`, `mode`, `state`, `error` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Community 0` to `Community 7`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 1` to `Community 7`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `scripts` connect `Community 2` to `Community 7`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **What connects `authClient`, `session`, `mode` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._