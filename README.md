# stubber-json — Stubber platform & explode / implode

CLI to **explode** a Stubber template/workflow JSON into a directory of files (for Git, IDEs, and AI agents) and **implode** it back to a single JSON for import.

## Stubber platform

The **Stubber Framework** is a structured methodology for processes and AI agents. The **Stubber Platform** is the hosted software: [app.stubber.com](https://app.stubber.com/) (runtime), [editor.stubber.com](https://editor.stubber.com/) (template editor). Documentation: [docs.stubber.com](https://docs.stubber.com/).

Core concepts ([Getting started — Overview](https://docs.stubber.com/getting-started/overview)):

| Concept | Meaning |
|--------|---------|
| **Flow** | A visual map of a process: how work moves from start to a defined end. |
| **State** | A resting point: the process pauses there until something moves it forward. |
| **Action** | An event or update inside a state: performs work and/or transitions to another state. |
| **Stub** | One **instance** (run) of a flow—a single FSM execution with its own data and history. |

Exported templates are **single JSON documents** that describe the **finite state machine** and **actions** of a flow, plus editor metadata (`actions`, `states`, `details`, `annotations`, `data`, canvas `structure`, tasks, notifications, and so on). Substitution often uses Handlebars (`{{…}}`), `~~…` value replacement, and **JSONata** in tasks like Save data—see [Variable substitution](https://docs.stubber.com/docs/concepts/substitution) and [Tasks](https://docs.stubber.com/docs/templates/actions/tasks).

## Explode / implode workflow

**Pain point:** teams want Git review, diffing, IDE support, and AI-assisted edits—but everything lives in one large JSON from a **low-code** canvas.

**Approach:** treat the JSON as the **source of truth** at import/export time, but **explode** it into a **project directory** for day-to-day work, then **implode** before re-importing Stubber.

| Command | Purpose |
|---------|---------|
| `explode` | Split template JSON into `template/` parts; extract `tasktype: "code"` bodies to `.js` under `tasks-code/`. |
| `implode` | Reassemble a single JSON file for Stubber import. |
| `validate` | Check manifest hashes and layout. |

- **No edits:** if every tracked file still matches its manifest SHA256, `implode` copies `.stubber/original.json` so output is **byte-identical** to the export.
- **After edits:** JSON is rebuilt from `template/` parts using stored key orders; edit `tasks-code/*.js` for JavaScript code tasks.

## Quick start

```bash
npm install
npm run build

node dist/cli.js explode /path/to/template.json /path/to/project-dir
node dist/cli.js implode /path/to/project-dir /path/to/repacked.json
node dist/cli.js validate /path/to/project-dir
```

After `npm install`, you can use the `stubber-json` binary from `package.json` if linked globally (`npm link` or `npm install -g .`).

Sample exports and pre-exploded projects live in the [parent repo](../README.md) (e.g. [`flow-circus-bookings.json`](../flow-circus-bookings.json), [`exploded/flow-circus-bookings/`](../exploded/flow-circus-bookings/)).

---

## Exploded directory layout

```
<project>/
  project.json                 # tool metadata (schema, explodedAt, source name)
  .stubber/
    original.json              # verbatim copy of the input file (bytes)
    manifest.json              # file SHA256s, key orders, code slot map
  template/
    details.json               # if present in source
    data.json                  # if present
    annotations/
      <annotation-key>.json    # one file per annotation entry
    actions/
      <action-key>/
        action.json            # action without inlined tasks/notifications/fields
        tasks/
          <order>__<task-key>.json
        tasks-code/
          <order>__<task-key>.js   # only for code tasks with extractable body
        notifications/
          <order>__<notif-key>.json
        fields/
          <order>__<field-key>.json
    states/
      workflow-fsm.md          # Mermaid state diagram + action list (explode only; not imploded)
      <state-key>/
        state.json             # state with hook task objects emptied if extracted
        hooks/<phase>/tasks/...
        hooks/<phase>/tasks-code/...
```

`action-key` / `state-key` segments are filesystem-safe (special characters sanitized).

### Byte-identical round-trip (no edits)

If **every file listed in** `manifest.files` still matches its **SHA256**, `implode` **copies** `.stubber/original.json` to the output path, so the result is **byte-for-byte identical** to the file you exploded—**including** indentation and key order quirks of the original export.

If anything changed (including `project.json`), the tool **rebuilds** JSON from the parts using stored key orders (still valid JSON for Stubber import; formatting may differ from the original).

---

## Template / workflow JSON (structure of exports)

### Typical top-level keys

Across typical workflow exports, you commonly see some combination of:

| Key | Role |
|-----|------|
| `actions` | Map of **action name → action definition** (fields, tasks, notifications, transitions, canvas `structure`, AI `action_meta`, …). |
| `states` | Map of **state name → state definition** (`actions` available in that state, `state_hooks`, `state_meta`, `structure`, …). |
| `details` | Template-level metadata (e.g. `editor_version`, `busy_start_state`). |
| `annotations` | Canvas annotations (notes, links, headers, demo stubs, …). |
| `data` | Template **data** (prompts, settings, default LLM labels, …). |

**Key order at the root differs by file** (e.g. `actions` first vs `details` first). The CLI **preserves** key orders via `.stubber/manifest.json` so rebuilt JSON stays consistent when you intentionally rebuild.

### Actions

Each action typically includes:

- `name`, `__key`, `to_state` (conditional transitions to next states)  
- `fields` — user-visible inputs (types like `text`, `select`, `note`, …)  
- `tasks` — ordered automation (`tasktype`, `params`, `conditions`, …)  
- `notifications` — outbound messages (WhatsApp, email, webchat, …)  
- `structure.position` — canvas coordinates (the “Miro-like” board)  
- `action_meta` — AI exposure, webhooks, injection settings  

### States

Each state typically includes:

- `actions` — array of **action names** allowed in that state  
- `state_hooks` — `on_enter_state` / `in_state` / `on_exit_state`, each with optional `tasks`, `notifications`, `metrics`  
- `state_meta` — AI behaviour for that state (e.g. inject description, chat name)  
- `structure` — canvas layout; `done` states often set `meta.is_done`  

### JavaScript **code** tasks

In some templates, `tasktype: "code"` appears with:

- `params.language` (e.g. `"javascript"`)  
- `params.code` — legacy / duplicate inline source in some tasks  
- `params.code_execution.code_block` — primary block, often with `options.failsafe.max_execution_time_seconds`  

The CLI extracts the executable body to **`.js` files** under `tasks-code/` and restores both slots on implode when the manifest records **`codeSlots`** (so behaviour matches the original dual-field pattern).

### Example: `flow-circus-bookings` (inline JSON → regular `.js` file)

The [`flow-circus-bookings.json`](../flow-circus-bookings.json) export defines action `confirm_payment` with a code task `update_ticket_inventory`. In the **single-file** export, the whole script is one string on `params.code_execution.code_block` (newlines are `\n` inside the JSON string):

```json
"update_ticket_inventory": {
  "tasktype": "code",
  "params": {
    "language": "javascript",
    "code_execution": {
      "options": {
        "failsafe": { "max_execution_time_seconds": 60 }
      },
      "code_block": "<entire script as one JSON string; newlines are \\n escapes>"
    }
  },
  "name": "update_ticket_inventory",
  "__key": "update_ticket_inventory",
  "__order": 3,
  "conditions": []
}
```

In the real [`flow-circus-bookings.json`](../flow-circus-bookings.json) export, `code_block` holds the full script on a single logical line (find `confirm_payment` → `tasks` → `update_ticket_inventory`).

After **`explode`**, the task is a normal JSON fragment **without** the embedded source, and the JavaScript is a **regular file** you can open in an editor with syntax highlighting, diffs, and formatters:

**Task metadata** — [`exploded/flow-circus-bookings/template/actions/confirm_payment/tasks/3__update_ticket_inventory.json`](../exploded/flow-circus-bookings/template/actions/confirm_payment/tasks/3__update_ticket_inventory.json):

```json
{
    "tasktype": "code",
    "params": {
        "language": "javascript",
        "code_execution": {
            "options": {
                "failsafe": {
                    "max_execution_time_seconds": 60
                }
            }
        }
    },
    "name": "update_ticket_inventory",
    "__key": "update_ticket_inventory",
    "__order": 3,
    "conditions": []
}
```

**Extracted script** — [`exploded/flow-circus-bookings/template/actions/confirm_payment/tasks-code/3__update_ticket_inventory.js`](../exploded/flow-circus-bookings/template/actions/confirm_payment/tasks-code/3__update_ticket_inventory.js):

```javascript
const show = stub.data.selected_show;
const numberTickets = Number(stub.data.number_tickets || 0);
const inventory = stub.data.ticket_inventory || {};
const currentShow = inventory[show] || { total_tickets: 100, tickets_sold: 0, tickets_remaining: 100 };
const updatedInventory = {
  ...inventory,
  [show]: {
    ...currentShow,
    tickets_sold: Number(currentShow.tickets_sold || 0) + numberTickets
  }
};
if (typeof _stubber !== 'undefined' && _stubber.utilities?.queue_savedata) {
  _stubber.utilities.queue_savedata('ticket_inventory', updatedInventory);
}
return {
  show,
  tickets_sold: updatedInventory[show].tickets_sold,
  tickets_remaining: updatedInventory[show].tickets_remaining
};
```

`implode` merges this `.js` back into the task object so Stubber still receives the same `code_block` (and any mirrored slots recorded in the manifest).

---

## Manifest schema (v1)

Stored at `.stubber/manifest.json`:

| Field | Purpose |
|-------|---------|
| `version` | Always `1` for this tool version. |
| `sourceFileName` | Original basename. |
| `originalSha256` | Hash of `.stubber/original.json`. |
| `indentSize` | Detected indent (2 or 4 spaces) for rebuild formatting. |
| `topLevelKeyOrder` | Root key order for stringify. |
| `objectKeyOrders` | Map of JSON Pointer string → ordered keys for that object. |
| `files` | Each tracked path + `sha256` + `kind` + merge metadata (`actionKey`, `taskKey`, `codeSlots`, …). |

`kind` values include: `original`, `project_meta`, `details`, `data`, `annotations`, `action`, `task`, `task_code`, `notification`, `field`, `state`, `state_hook_task`.

---

## Official references

- [Stubber](https://www.stubber.com/)  
- [Docs home](https://docs.stubber.com/)  
- [Framework / platform overview](https://docs.stubber.com/docs/concepts/overview)  
- [Flows, states, actions, stubs](https://docs.stubber.com/getting-started/overview)  
- [Variable substitution](https://docs.stubber.com/docs/concepts/substitution)  
- [Stubs](https://docs.stubber.com/docs/stubs)  
- [Stub data structure](https://docs.stubber.com/docs/stubs/stub-data-structure)  
- [Tasks](https://docs.stubber.com/docs/templates/actions/tasks)  
- [Save data](https://docs.stubber.com/docs/templates/actions/tasks/savedata)  
- [GPT Chat task](https://docs.stubber.com/docs/templates/actions/tasks/gpt-chat-task)  
- [LLM models](https://docs.stubber.com/docs/reference/llm-models)  
- [Create template from scratch](https://docs.stubber.com/getting-started/create-your-first-template/from-scratch)  
- [Introduction to AI](https://docs.stubber.com/getting-started/introduction-to-ai)  

---

## Development

```bash
npm test
```
