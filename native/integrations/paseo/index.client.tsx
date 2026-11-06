import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BeadsPanel, BeadsScreen } from "./client/board.js";

function BeadsSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="ListTodo" active={currentScreen?.screenId === "beads"}
    onPress={() => openScreen({ screenId: "beads" })} />;
}

export default function contribute(client: PluginClientContext) {
  const cleanup = [
    client.addScreen({ id: "beads", title: "Beads", Component: BeadsScreen }),
    client.addSidebarHeaderItem({ id: "beads", title: "Beads", Component: BeadsSidebar }),
    client.addWorkspacePanel({
      id: "beads", title: "Beads", icon: "ListTodo",
      locations: ["workspace", "explorer"], Component: BeadsPanel,
    }),
    client.addCommandCenterItem({
      id: "open-beads", title: "Open Beads board", icon: "ListTodo", context: "workspace",
      keywords: ["issues", "ready", "blocked", "tasks"],
      onSelect: ({ openPanel }) => openPanel("beads"),
    }),
    client.addSlashCommand({
      name: "beads", description: "Open the workspace Beads board", argumentHint: "", context: "workspace",
      onSubmit({ openPanel, args }) {
        if (args.trim()) throw new Error("/beads takes no arguments. Use the board to manage issues.");
        openPanel("beads");
      },
    }),
  ];
  return () => { for (const dispose of cleanup.reverse()) void dispose(); };
}
