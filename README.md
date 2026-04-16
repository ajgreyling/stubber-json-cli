# stubber-json

CLI to **explode** a Stubber template/workflow JSON into a directory of files (for Git, IDEs, and AI agents) and **implode** it back to a single JSON for import.

## Quick start

```bash
npm install
npm run build

node dist/cli.js explode /path/to/template.json /path/to/project-dir
node dist/cli.js implode /path/to/project-dir /path/to/repacked.json
node dist/cli.js validate /path/to/project-dir
```

- **No edits:** `implode` output is **byte-identical** to the original JSON (fast path via `.stubber/original.json` + manifest hashes).
- **After edits:** JSON is rebuilt from `template/` parts; edit `tasks-code/*.js` for JavaScript code tasks.

See **[../STUBBER_PLATFORM_AND_EXPLODE.md](../STUBBER_PLATFORM_AND_EXPLODE.md)** for platform context, folder layout, and manifest details.

## Development

```bash
npm test
```
