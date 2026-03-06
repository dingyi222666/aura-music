# Agent Instructions for aura-music

This file defines how agentic tools should work in this repository.
It applies to the entire tree under the repo root.

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without extra confirmation unless
  blocked by missing info or safety/irreversibility.

## Repo & Branches

- Frontend-only React + Vite + TypeScript application.
- Default branch is `main`; use `main` or `origin/main` for diffs.
- No monorepo structure; everything lives at the repo root.
- There are currently **no** `.cursor/rules`, `.cursorrules`, or
  `.github/copilot-instructions.md` files. If they are added later, follow
  them in addition to this file.
- Path alias: `@` resolves to the project root (see `tsconfig.json`).

## Tooling & Commands

### Install

- Use a recent Node.js (>= 18) and Bun installed globally.
- Install dependencies with one of:
  - `npm install`
  - `bun install`

### Dev server

- Start the React dev server (Vite):
  - `npm run dev`
  - or `bun run dev`

### Build & preview

- Production build:
  - `npm run build`
  - or `bun run build`
- Preview a production build locally:
  - `npm run preview`
  - or `bun run preview`

### Tests (Bun)

Tests live under `tests/` and use `bun:test` (`import { test, expect } from "bun:test"`).

- Run the full test suite from the repo root:
  - `bun test tests`
  - or via npm script: `npm test` (which runs `bun test tests`).
- Run a single test file (preferred pattern for agents):
  - `bun test tests/yrc.test.ts`
  - `bun test tests/enhance_lrc.test.ts`
- Run tests matching a name pattern (example; see `bun test --help` for details):
  - `bun test tests --filter "YRC enrichment"`
  - Use the full or partial test description string from the `test("...")` call.
- Avoid introducing other test runners (Jest, Vitest, etc.) unless explicitly
  requested; keep tests on Bun.

### Linting & formatting commands

- There is currently **no** ESLint or Prettier configuration in this repo.
- Do **not** add new linters/formatters or config files without an explicit
  request from the user.
- Rely on TypeScript and the existing code style as the primary source of
  truth for correctness and style.

## Testing Guidelines

- New tests should be placed under `tests/` and use Bun's test API:
  - `import { test, expect } from "bun:test";`
- Prefer focused, integration-style tests over heavy mocking.
  - Example: use real lyrics parsing through `parseLyrics` rather than
    re-implementing its logic inside tests.
- Reuse the existing patterns in files like `tests/yrc.test.ts` and
  `tests/enhance_lrc.test.ts` for naming, structure, and expectations.
- Test data lives in `tests/resources/`; prefer adding new fixtures there
  instead of inlining very large strings directly in tests.
- When debugging or narrowing failures, run only the relevant test file or
  filtered tests as described above.

## General TypeScript Style

- Use modern ES modules with TypeScript (`.ts` / `.tsx`).
- Keep related logic in a single function unless splitting clearly improves
  reuse or readability.
- Prefer `const` over `let` and avoid `var`.
- Prefer early returns over deep nesting and `else` chains.
- Avoid `any` where possible; if you must use it (for interop with
  third-party globals like `jsmediatags` or `ColorThief`), keep the `any` as
  localized as possible.
- Use interfaces/types for exported shapes, especially in shared files like
  `types.ts` and `services/lyrics/types.ts`.
- Use TypeScript's type inference where it keeps the code clear; avoid
  redundant type annotations for obvious local variables.
- Prefer functional array methods (`map`, `filter`, `flatMap`, `reduce`) over
  manual loops; use type guards in `filter` to preserve downstream
  type inference.
- Avoid unnecessary destructuring; prefer dot notation when it keeps context
  clearer (see examples below).

## Imports

- Use ESM import syntax at the top of the file.
- Group imports roughly in this order:
  1. Node/built-in modules (`node:path`, `node:fs`, etc.).
  2. Third-party packages (`react`, `@react-spring/web`, `@google/genai`).
  3. Absolute project imports via `@/...`.
  4. Relative imports (`../services/...`, `./components/...`).
- Keep React imports explicit when needed (e.g. `import React, { useState } from "react";`).
- For deep cross-tree imports, prefer the `@` alias over long `../../..`
  chains where it improves clarity.

## React Components & Hooks

- Use function components (`const Component: React.FC<Props> = (...) => { ... }`).
- Define props with an `interface` or `type` near the top of the file.
- Use hooks for state and side effects as in `App.tsx` and `LyricsView.tsx`.
- Keep components focused; pull out complex behavior into hooks under
  `hooks/` or utilities under `services/` when it improves reuse.
- Prefer controlled components and prop-driven behavior over global state
  where possible.
- For UI styling, this project uses Tailwind-style utility class strings
  directly in `className` (e.g. `"h-[85vh] flex"`); follow the existing
  patterns when editing or adding UI.

## Naming Conventions

- Use PascalCase for React components, types, and enums (`LyricsView`,
  `PlayState`).
- Use camelCase for variables, functions, hooks, and non-component exports.
- Hooks should start with `use` (`useLyricsPhysics`, `usePlaylist`).
- Files containing React components should use PascalCase names ending in
  `.tsx` (e.g. `LyricsView.tsx`).
- For new TypeScript **locals, parameters, and small helpers**, prefer single
  word names when they stay clear.
  - Multi-word names are fine when a single word would be confusing
    (`activeIndex`, `matchStatus`, `currentTime`).
- Before finishing edits, quickly scan new names and shorten them if a clear
  single-word alternative exists.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT-WRITTEN CODE.

- Use single word names by default for new locals, params, and helper
  functions.
- Multi-word names are allowed only when a single word would be unclear or
  ambiguous.
- Do not introduce new camelCase compounds when a short single-word
  alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced
  identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`,
  `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`,
  `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1;
function journal(dir: string) {}

// Bad
const fooBar = 1;
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const fullName = `${user.firstName} ${user.lastName}`;

// Bad
const first = user.firstName;
const last = user.lastName;
const fullName = `${first} ${last}`;
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
user.profile.name;
user.profile.avatarUrl;

// Bad
const { name, avatarUrl } = user.profile;
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of
reassignment.

```ts
// Good
const value = condition ? 1 : 2;

// Bad
let value;
if (condition) value = 1;
else value = 2;
```

### Control Flow

Avoid `else` statements when a simple early return works.

```ts
// Good
function foo(condition: boolean) {
  if (condition) return 1;
  return 2;
}

// Bad
function foo(condition: boolean) {
  if (condition) return 1;
  else return 2;
}
```

### Schema Definitions (Drizzle)

If you add Drizzle ORM schema definitions in the future, use `snake_case` for
field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
});

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

## Error Handling

- For network and I/O helpers (for example in `services/utils.ts`):
  - Use `try`/`catch` around external calls (`fetch`, `jsmediatags.read`,
    `ColorThief`) and log via `console.warn` or `console.error`.
  - Return safe fallbacks (`[]`, `{}`, `null`) when the UI can recover.
- Avoid swallowing errors silently; either log them or let them propagate to
  the caller where they can be handled.
- Do not introduce global error handlers or error boundaries without checking
  with the user; keep behavior consistent with the current app.

## Formatting

- Use 2-space indentation for new or heavily edited code.
- Use double quotes (`""`) for strings in TypeScript and JSX; the existing
  codebase mixes quotes, but move toward double quotes when you touch a line.
- Always terminate statements with semicolons.
- Prefer trailing commas in multi-line object/array literals where supported.
- Keep lines to a reasonable length; break up long expressions or JSX props
  instead of letting lines grow excessively wide.
- Keep JSX easy to scan: one prop per line for complex components, and
  nested conditional rendering kept simple.

## Vite, Env, and Paths

- Vite config lives in `vite.config.ts` and uses `loadEnv` to inject
  environment variables.
- The `GEMINI_API_KEY` is read from env and exposed via `process.env.*` in
  the client bundle; **never** hard-code secrets in the repo.
- When adding new env variables, wire them through Vite's `loadEnv` and
  document them in this file or in README.
- Use the `@` alias if it improves readability, e.g. `@/services/lyrics`.

## Agent-Specific Tips

- Prefer making small, focused changes that match existing patterns in the
  surrounding code.
- When adding features, update or add Bun tests under `tests/` instead of
  creating new test directories or runners.
- Do not introduce backend code or separate servers unless explicitly asked;
  this project is a client-side React app.
- When in doubt about style, look at `App.tsx`, `components/LyricsView.tsx`,
  and `services/utils.ts` and match their patterns.
