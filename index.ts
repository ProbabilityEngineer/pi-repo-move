import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("move", {
    description: "Move the current repo and relocate its Pi session bucket. Planned: /move <target>",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-move is scaffolded; /move implementation is tracked in tickets.", "info");
    },
  });
}
