import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";

/** The agents that have a plugin command. */
export type PluginAgent = "claude" | "codex" | "pi";

export interface Plugin {
  /**
   * What the agent installs.
   * - claude, codex: `<plugin>@<marketplace>`, for example `pstack@pstack-claude`.
   * - pi: a package source, for example `git:github.com/earendil-works/pi-review`.
   */
  name: string;
  /** claude, codex: where the marketplace comes from, for example the GitHub repository `owner/name`. */
  marketplace?: string;
}

export interface PluginsProps {
  /** SSH destination of the machine. */
  sshDest: string;
  agent: PluginAgent;
  plugins: Plugin[];
  /** A new value makes the resource run again, so that the plugins move to the newest version. */
  refresh?: string;
}

/**
 * The plugins of one agent on the machine, installed with the plugin command
 * of that agent. A plugin that leaves `plugins` is removed from the machine.
 */
export type Plugins = Resource<"Agent.Plugins", PluginsProps, { names: string[] }, never, Providers>;
export const Plugins = Resource<Plugins>("Agent.Plugins");

export class PluginsError extends Data.TaggedError("PluginsError")<{ message: string }> {}

/** The commands of each agent. Each one is safe to run again. */
const commands: Record<PluginAgent, { install: (plugin: Plugin) => string[]; remove: (name: string) => string }> = {
  claude: {
    install: ({ name, marketplace }) => [
      ...(marketplace ? [`claude plugin marketplace add "${marketplace}"`] : []),
      `claude plugin marketplace update "${name.split("@")[1] ?? ""}"`,
      `claude plugin install "${name}"`,
      `claude plugin update "${name}"`,
    ],
    remove: (name) => `claude plugin uninstall "${name}"`,
  },
  codex: {
    install: ({ name, marketplace }) => [
      ...(marketplace ? [`codex plugin marketplace add "${marketplace}"`] : []),
      "codex plugin marketplace upgrade",
      `codex plugin add "${name}"`,
    ],
    remove: (name) => `codex plugin remove "${name}"`,
  },
  pi: {
    install: ({ name }) => [`pi install "${name}"`, `pi update "${name}"`],
    remove: (name) => `pi remove "${name}"`,
  },
};

// A name goes into a shell command, so only plain names are permitted.
const checked = (values: string[]): Effect.Effect<void, PluginsError> => {
  const bad = values.find((value) => !/^[A-Za-z0-9@._:/-]+$/.test(value));
  return bad === undefined
    ? Effect.void
    : Effect.fail(new PluginsError({ message: `"${bad}" is not a valid plugin or marketplace name.` }));
};

export const PluginsProvider = provider(Plugins, {
  reconcile: Effect.fn(function* ({ news, output }) {
    const names = news.plugins.map((plugin) => plugin.name);
    const removed = (output?.names ?? []).filter((name) => !names.includes(name));
    yield* checked([...names, ...removed, ...news.plugins.flatMap((plugin) => plugin.marketplace ?? [])]);
    const agent = commands[news.agent];
    const script = [...removed.map(agent.remove), ...news.plugins.flatMap(agent.install)].join("\n");
    if (script) yield* runScript(news.sshDest, script);
    return { names };
  }),
  delete: ({ olds, output }) =>
    output.names.length === 0
      ? Effect.void
      : checked(output.names).pipe(
          Effect.flatMap(() => cleanUp(olds.sshDest, output.names.map(commands[olds.agent].remove).join("\n"))),
          Effect.ignore,
        ),
});
