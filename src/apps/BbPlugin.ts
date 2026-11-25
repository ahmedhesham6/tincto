import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runScript } from "../remote/Ssh.ts";

export interface BbPluginProps {
  /** SSH destination of the machine that runs the bb server. */
  sshDest: string;
  /** Plugin source, as `bb plugin install` accepts it: a catalog name, `git:<url>@<range>`, or `npm:<name>@<version>`. */
  source: string;
}

/**
 * A plugin of the bb server on the machine. A new source installs that source.
 * Destroy leaves the plugin: `bb plugin remove` needs the plugin ID, and it
 * deletes the settings of the plugin.
 */
export type BbPlugin = Resource<"Bb.Plugin", BbPluginProps, { source: string }, never, Providers>;
export const BbPlugin = Resource<BbPlugin>("Bb.Plugin");

// A second install of the same source fails. Then the list must show the source.
const install = `bb plugin install "$SOURCE" --yes || bb plugin list | grep -F -- "$SOURCE" >/dev/null`;

export const BbPluginProvider = provider(BbPlugin, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, install, { SOURCE: news.source });
    return { source: news.source };
  }),
  delete: () => Effect.void,
});
