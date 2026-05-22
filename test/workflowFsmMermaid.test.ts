import { describe, it, expect } from "vitest";
import { renderWorkflowFsmMarkdown } from "../src/workflowFsmMermaid.js";
import type { JsonObject } from "../src/types/json.js";

describe("renderWorkflowFsmMarkdown", () => {
  it("returns null when root has no states", () => {
    expect(renderWorkflowFsmMarkdown({ actions: {} } as JsonObject)).toBeNull();
  });

  it("declares vertex aliases and uses unquoted ids on edges", () => {
    const root: JsonObject = {
      details: { busy_start_state: "active" },
      states: {
        active: {
          name: "active",
          actions: ["confirm_payment", "noop"],
          structure: {},
        },
        done: {
          name: "done",
          actions: [],
          structure: { meta: { is_done: true } },
        },
      },
      actions: {
        confirm_payment: {
          name: "confirm_payment",
          to_state: {
            done: {
              state: "done",
              conditions: [true],
              meta: { default: true },
            },
          },
        },
        noop: {
          name: "noop",
          to_state: {},
        },
      },
    };
    const md = renderWorkflowFsmMarkdown(root)!;
    expect(md).toContain("stateDiagram-v2");
    expect(md).toMatch(/state "active" as v_active;/);
    expect(md).toMatch(/state "done" as v_done;/);
    expect(md).toContain("[*] --> v_active;");
    expect(md).toContain("v_active --> v_done : confirm_payment (default);");
    expect(md).toContain("### `done` (terminal)");
    expect(md).toContain("- `confirm_payment`");
  });

  it("lists unknown action references", () => {
    const root: JsonObject = {
      states: {
        s1: { actions: ["missing_action"], structure: {} },
      },
      actions: {},
    };
    const md = renderWorkflowFsmMarkdown(root)!;
    expect(md).toContain("Unresolved action references");
    expect(md).toContain("s1 → ? (missing_action)");
  });
});
