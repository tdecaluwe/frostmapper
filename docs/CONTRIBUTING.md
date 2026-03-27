---
covers: docs/CONTRIBUTING.md
version: 0.1.0
status: approved
priority: core
---

# Contributing to FrostMapper Specs

This document explains how the spec collection is organised and how to write or update a spec.

---

## Folder Structure

```
docs/
  CONTRIBUTING.md           ← this file
  ARCHITECTURE.md          ← system overview (start here)
  adr/                    ← architectural decision records
    ADR-001-*.md
    ...
  specs/
    core/                 ← framework-agnostic model layer
    sources/              ← concrete data source specs
    layers/              ← concrete layer specs (future)
    controller/           ← orchestration specs (future)
    view/                ← Vue component specs (future)
  webgl/                 ← WebGL rendering specs (future)
```

---

## Spec Frontmatter

Every spec file must include YAML frontmatter:

```yaml
---
covers:
  - src/path/to/file.js
  - tests/path/to/file.test.js
  - tests/path/to/other_file.test.js
version: 0.1.0
status: draft
priority: core
---
```

| Field | Required | Values | Notes |
|-------|----------|--------|-------|
| `covers` | Yes | YAML list of file paths | Implementation files and their test files. One entry per class for multi-class specs. |
| `version` | Yes | Semver string | Start at `0.1.0`; bump when spec changes significantly |
| `status` | Yes | `draft`, `approved`, `deprecated` | `draft` = being written; `approved` = ready to implement; `deprecated` = replaced |
| `priority` | Yes | `core`, `demo`, `live`, `feature` | Determines build order — see Priority Levels below |

---

## Priority Levels

Priority indicates when a spec is needed in the development cycle:

| Priority | Meaning | Implementation order |
|----------|---------|-------------------|
| `core` | Infrastructure everything else depends on | First — no dependencies |
| `demo` | Needed for the first working demo | After core |
| `live` | Needed for production-quality launch | After demo |
| `feature` | Post-MVP additions | Whenever capacity allows |

**Core** specs must be complete before any other spec is implemented.

**Build order:** `core` → `demo` → `live` → `feature`

---

## Spec Sections

Every spec should contain, in order:

1. **Interface overview** — TypeScript `declare class` / `declare type` block listing all exported types and their public surface. No prose here. AI builders scan this first.
2. **Purpose** — what this module does and why it exists
3. **Interface details** — detailed signatures for each class/method (fenced code blocks), behaviour not obvious from the signature
4. **Behaviour** — detailed explanation of how it works
5. **Error handling** — how failures are surfaced and handled
6. **Dependencies** — what this module requires (imports, external APIs, data sources)
7. **Test cases** — specific, executable scenarios grouped by class under `### ClassName` headings. Each test case is numbered starting from 1 within its class section. Do **not** write test code — describe the test in prose so the implementing agent decides how to write it

---

## Naming Conventions

- One spec per module
- Spec filename mirrors the source file: `cache.js` → `cache.spec.md`
- Test file names use underscores, not dashes: `raster_slice.test.js`, `tile_id.test.js`
- Test cases are numbered per-class, starting from 1. No prefixes. Example: `**1.**`, `**2.**`, `**3.**`
- Use present tense: "verify", "assert", "returns" — not "should verify" or "should return"

## TypeScript Declaration Syntax

The interface overview uses TypeScript `declare` syntax to describe the public surface. This is the canonical reference — all public members are listed, no implementation details.

```typescript
declare class Point {
  constructor(x: number, y: number, crs: string)
  get x(): number
  get y(): number
  as(targetCRS: string): Point
}

declare class RasterSlice<T extends TypedArray> implements RasterLike<T> {
  constructor(raster: RasterClass<T>, { north, south, east, west }: Bounds)
  get buffer(): ArrayBuffer
  north(n: number): RasterSlice<T>
  // ...
}
```

Use `declare class` for classes, `declare type` for intersection/union types, `declare const` for exported constants, `declare function` for standalone functions. Private methods use `/** @internal */` annotation.

## Type Declarations

TypeScript declaration files (`.d.ts`) are generated from the spec's interface overview section. The spec is the source of truth — the `.d.ts` files are derived artefacts.

Location: alongside the implementation files in `src/`, so VSCode provides IntelliSense automatically.

```
src/
  core/
    primitives.js      ← implementation
    primitives.d.ts    ← generated from spec
```

When a spec is approved, the type declarations are extracted from the interface overview and written to the corresponding `.d.ts` file. The spec's `covers` frontmatter documents the relationship.

---

## What to Include

- **All public interface members** — every exported class, method, function, constant
- **Behaviour** that isn't obvious from the signature — especially edge cases and error paths
- **Domain decisions** — why this works the way it does (useful for future maintainers)
- **Test scenarios** that cover both happy paths and failure modes

## What to Exclude

- Do **not** specify internal implementation details — only the public interface
- Do **not** include prose about motivation unless it affects implementation choices
- Do **not** write test code — write test scenarios
- Do **not** pad sections that don't need content

---

## Updating a Spec

When changing an existing spec:

1. Bump `version` (patch for small fixes, minor for new behaviour, major for breaking changes)
2. Set `status: draft` if the change affects implementation
3. Update relevant test cases to match new behaviour
4. Note the change in the spec history (add a line at the top: `Changed in v0.x.0: ...`)

---

## Reading Order for AI Builders

1. Start with `ARCHITECTURE.md` — understand the system
2. Read specs in priority order: `core` → `demo` → `live` → `feature`
3. Within each priority, read specs in dependency order: a spec's imports indicate what must be read first
4. When implementing a module, read only the spec for that module — not all specs

---

## Common Design Patterns

These conventions apply across all specs unless overridden.

### Immutability

Read-only types are made immutable via `Object.freeze` after construction. Attempting to assign to a property after construction throws in strict mode. State that must change produces a new instance rather than mutating.

### Lazy Evaluation

When a type performs expensive computation, that computation is deferred until the result is actually needed. The spec names the trigger explicitly (e.g., `buffer` resolves a `RasterSlice`).

### Fluent Chaining Returns New Instances

Methods that accept parameters and return the same type (e.g., `north(n)` on `RasterSlice`) return a new instance. The original is never mutated.

### Type Tag by Class

When multiple types share a common structure (e.g., `Float32Raster`, `Uint8Raster`), the type distinction is expressed by the class itself — not a `dtype` field or constructor argument. Each class knows its own TypedArray constructor.

---

## Spec Status Definitions

| Status | Meaning |
|--------|---------|
| `draft` | Being written or substantially changed. Do not implement from this spec yet. |
| `approved` | Spec is stable. Implement from this. |
| `deprecated` | Spec has been replaced. Check the replacement spec. |
