# Agent Rules

## Code Style

### No Magic Numbers

Never use hardcoded numeric values (magic numbers) in CSS or JavaScript. Always define named constants:

- **CSS**: Use CSS custom properties in `:root` (e.g., `--col-check-width: 72px;`) and reference them with `var(--col-check-width)`.
- **JavaScript**: Use named constants at module scope (e.g., `const PAGE_SIZE = 50;`).

This ensures:
1. Single source of truth for related values
2. Self-documenting code (the name explains the purpose)
3. Easy maintenance (change in one place updates everywhere)

## Build Rules

Every task MUST end with these steps, in order:

1. **Increment version**: Update the `version` field in `burning-chrome/manifest.json` (semver patch increment)
2. **Run build**: Execute `npm run build` from the `burning-chrome` directory

This applies even if no frontend files were modified. It ensures version tracking and build success verification.