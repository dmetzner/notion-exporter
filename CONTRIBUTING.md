# Contributing

Thanks for considering a contribution!

## Dev setup

```bash
git clone https://github.com/dmetzner/notion-exporter
cd notion-exporter
pnpm install
cp .env.example .env   # add a token if you want to run live
pnpm test
```

## Workflow

1. Open an issue first for non-trivial changes — saves wasted effort if the
   direction doesn't fit.
2. Branch from `main`, name it `feat/<short>` or `fix/<short>`.
3. Run `pnpm check` — the canonical pre-PR gate (mirrors CI; runs lint +
   typecheck + tests + WCAG contrast). For partial runs use any of the
   four sub-commands directly: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm contrast`.
4. Open a PR. CI must be green before review.

## Commit messages

Conventional Commits style:

- `feat: add --resume flag`
- `fix(assets): retry transient 5xx on asset host`
- `docs: clarify integration share step`
- `refactor:`, `test:`, `chore:`, `ci:` — all welcome.

## Coding rules

- TypeScript strict mode; no `any` without justification.
- Biome handles formatting/lint — run `pnpm lint:fix` before committing.
- Tests live in `test/` and use vitest. New features ship with tests.
- Keep external dependencies minimal — every new dep is a maintenance promise.

## Areas where help is wanted

- Picking up an in-flight item from [`ROADMAP.md`](./ROADMAP.md) or one of
  the open [GitHub issues](https://github.com/dmetzner/notion-exporter/issues).
- Support for additional block types in the Markdown converter
  (`src/export/markdown.ts`) — note the renderer is intentionally hand-rolled.
- Test fixtures from real (anonymised) workspaces.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating you agree to abide by its terms.

## License

By contributing you agree your work is licensed under the project's MIT license.
