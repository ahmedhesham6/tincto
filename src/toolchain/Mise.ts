import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runScript } from "../remote/Ssh.ts";

export interface MiseProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /**
   * Tool name and version, as in the `[tools]` table of mise: `node = "24"`,
   * `kubectl = "latest"`, `"npm:t3" = "0.1.12"`.
   */
  tools: Record<string, string>;
  /**
   * How old a release must be before mise installs it for an open version, for
   * example `24h`. `0s` installs a release at once. mise uses 24 hours when you omit this.
   */
  minimumReleaseAge?: string;
  /**
   * A new value makes the resource run again, so that mise moves each tool
   * with an open version (`latest`, `24`) to the newest release.
   */
  refresh?: string;
}

/**
 * The command-line tools of the machine, installed by mise for the user, with
 * no root. The resource owns `~/.config/mise/config.toml`. A tool that leaves
 * `tools` is removed from the machine. Destroy leaves the tools: services on
 * the machine can need them.
 */
export type Mise = Resource<"Toolchain.Mise", MiseProps, { tools: Record<string, string> }, never, Providers>;
export const Mise = Resource<Mise>("Toolchain.Mise");

/** The mise config file for a tool list. */
export const miseConfig = (tools: Record<string, string>, minimumReleaseAge?: string) =>
  `# Managed by tincto (Toolchain.Mise). A deploy replaces this file.
${minimumReleaseAge ? `[settings]\nminimum_release_age = ${JSON.stringify(minimumReleaseAge)}\n\n` : ""}# The package manager that mise embeds cannot install some npm packages (bb-app is one), so npm does it.
[settings.npm]
package_manager = "npm"

[tools]\n${Object.entries(tools)
    .map(([name, version]) => `${JSON.stringify(name)} = ${JSON.stringify(version)}\n`)
    .join("")}`;

// MISE_YES answers each prompt with yes. `prune` removes the versions that the config no longer names.
const install = `
if ! command -v mise >/dev/null 2>&1; then
  curl -fsSL https://mise.run | sh
fi
mkdir -p "$HOME/.config/mise"
printf '%s' "$CONFIG" > "$HOME/.config/mise/config.toml"
export MISE_YES=1
mise install
mise upgrade
mise prune
mise reshim
# An interactive bash gets the tools too. zsh gets them from machine/home/zshrc.
grep -qs 'mise activate bash' "$HOME/.bashrc" || echo 'eval "$(mise activate bash)"' >> "$HOME/.bashrc"
`;

export const MiseProvider = provider(Mise, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, install, { CONFIG: miseConfig(news.tools, news.minimumReleaseAge) });
    return { tools: news.tools };
  }),
  delete: () => Effect.void,
});
