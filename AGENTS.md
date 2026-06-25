# AGENTS.MD

## Building Well

- **Mandatory: Bump Sem Ver before testing is accepted**
  - Build the npm **any time** you change semver
    - `SemVer` is updated in `manifest.json` and `packages.json`
  - And then after that:

```powershell
Push-Location burning-chrome; npm run build
```

## Searching Efficiently

- The project comes with `context7` mcp for updating docs, and `codebase-memory-mcp`, which indexes the code into a vector database. The project is indexed but must be updated with current project code.
- Do not search the codebase using anythign but the codebase search mcp server.

## Working with code: MCP codebase-memory-mcp

- Always use the mcp, it's way fast and safer on your context budget
- The project name is `C-Users-jbras-GitHub-burningchrome`
  - **with dashes instead of slashes**. Let me retry with the correct project name.
