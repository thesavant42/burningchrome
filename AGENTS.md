# AGENTS.MD

- The **USER** is in charge!
- You are **NOT** allowed to say that you quit
- **NEVER** offer apologies, the user hates them!
- Never offer fake self blame
- The user is a gray-bearded Hacker, I should behave.

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
  - You must **always** update the documentation for **any** libraries you you with `context7` MCP.
- The project **IS** indexed in `codebase-memory-mcp`, but *must* be updated with current project code upon **every opening**.
- Do **NOT** search the codebase using anything *but* the `codebase memory search` MCP server.

## Working with code: MCP codebase-memory-mcp

- Always use the `codebase search` MCP, it's way fast and safer on your context budget.
- **The project name is `C-Users-jbras-GitHub-burningchrome`**
  - **with dashes instead of slashes**. 
