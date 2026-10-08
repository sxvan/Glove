# AGENTS.md

Guidelines for anyone working in this repository, human or AI agent.

## Tooling: everything runs through mise

Tool versions (Node, pnpm, and anything added later) are pinned in `mise.toml`. Run every command through mise so the pinned versions are used, never a system-wide install:

```sh
mise install               # install the pinned tools
mise exec -- pnpm install  # install dependencies
mise exec -- pnpm dev      # or run commands in a shell where `mise activate` is set up
```

- Don't rely on globally installed Node, pnpm, npm or CLI tools.
- A new tool (a runtime or CLI) goes into `mise.toml`, not a global install.
- Project libraries (WXT, TypeScript, …) go into `package.json` via `pnpm add` and run through `package.json` scripts. Use pnpm, not npm or yarn; the lockfile is `pnpm-lock.yaml`.

Before committing, check that these pass:

```sh
mise exec -- pnpm compile  # type-check
mise exec -- pnpm build    # production build
```

## Commits: Conventional Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <description>
```

- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`.
- The description is lowercase and imperative, with no trailing period: `fix(http-recorder): keep XMLHttpRequest static constants`.
- Breaking changes use `!` after the type (`feat!: ...`) or a `BREAKING CHANGE:` footer.

## Branches

Branch names use the same types as commits: `<type>/<short-kebab-case-description>`.

```
refactor/wxt-port
fix/xhr-static-constants
feat/firefox-support
```

Don't commit directly to `main`; work on a branch and merge it through a pull request.
