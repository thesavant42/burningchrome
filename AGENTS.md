# AGENTS.MD

## Building Well

- **Mandatory: BUMP SEM VER before testing is accepted**
  - Build the npm **any time** you change semver
    - `SemVer` is updated in:
      - `manifest.json` and
      - `packages.json`
  - Build **even if you don't think you need to**
  - And then after that:

```powershell
Push-Location burning-chrome; npm run build
```

## Searching Efficiently

- The project comes with `context7` MCP for updating docs, and `codebase-memory-mcp`, which indexes the code into a vector database.
- You must always update the documentation for any libraries you you with `context7` MCP.
- The project IS indexed in `codebase-memory-mcp`, but must be updated with current project code on every opening.
- Do NOT search the codebase using anything but the `codebase search` MCP server.

## Working with code: MCP codebase-memory-mcp

- Always use the `codebase search` MCP, it's way fast and safer on your context budget.
- **The project name is `C-Users-jbras-GitHub-burningchrome`**
  - **with dashes instead of slashes**. Let me retry with the correct project name.
