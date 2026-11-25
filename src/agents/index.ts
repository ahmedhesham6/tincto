import { join } from "node:path";
import * as Namespace from "alchemy/Namespace";
import * as Effect from "effect/Effect";
import { after } from "../host/Host.ts";
import { machineName } from "../host/index.ts";
import { type Tools, toolVersion } from "../toolchain/index.ts";
import { today } from "../toolchain/versions.ts";
import { Home } from "./Home.ts";
import { type Plugin, type PluginAgent, Plugins } from "./Plugins.ts";
import { Skills, type SkillsProps } from "./Skills.ts";
import { stageAgents } from "./stage.ts";

export interface AgentConfig {
  /** Plugins that the agent installs with its own plugin command. Only claude, codex and pi have one. */
  plugins?: Plugin[];
  /** Files from machine/agents/<agent>/ and where they go, relative to the home directory. */
  files: Record<string, string>;
  /** Directory, relative to the home directory, where the agent reads its skills. */
  skillsDir: string;
  /** Names of directories in machine/skills/: the custom skills. */
  skills: string[];
}

export interface AgentsConfig {
  /** Files from machine/home/ and where they go, relative to the home directory. */
  home: Record<string, string>;
  /** The key is the name of the agent: `claude`, `codex`, `pi`, `bb`. */
  agents: Record<string, AgentConfig>;
  /** Skills from skill sources, and the agents that get them, as the `skills` CLI names them. */
  skills: Pick<SkillsProps, "agents" | "sources">;
}

/**
 * The component for agents: the instruction files of each agent, the custom skills,
 * the files from machine/home/, the skills from skill sources, and the plugins
 * of each agent. Needs the tool `npm:skills`, and the CLI of each agent that has plugins.
 * The home files have the ID of the component, and the other resources are below it. Default: none of each.
 */
export const Agents = Effect.fn("Tincto.Agents")(function* (
  id: string,
  props: Partial<AgentsConfig> & { tools: Tools },
) {
  const name = yield* machineName;
  yield* toolVersion(props.tools, "npm:skills", "Agents");
  const { host } = props.tools;
  // The project is the directory where the deploy runs: it has machine/, and Alchemy keeps .alchemy/ there.
  const project = process.cwd();
  const config = { home: props.home ?? {}, agents: props.agents ?? {} };
  const staged = stageAgents(config, join(project, "machine"), join(project, ".alchemy/staging", name, id));
  const home = yield* Home(id, { sshDest: host.sshDest, ...staged });

  // After Home: the two write the same skills directories, so they must not run at the same time.
  const ownsHome = after(host, home.entries);
  yield* Skills("Skills", {
    sshDest: ownsHome.sshDest,
    agents: props.skills?.agents ?? [],
    sources: props.skills?.sources ?? {},
    refresh: today(),
  }).pipe(Namespace.push(id));

  // After Home also: a plugin command changes the settings file of its agent, which Home copies.
  for (const [agent, { plugins }] of Object.entries(config.agents)) {
    if (!plugins?.length) continue;
    if (!isPluginAgent(agent))
      throw new Error(`The machine file gives plugins to "${agent}", which has no plugin command.`);
    yield* Plugins(`Plugins-${agent}`, { sshDest: ownsHome.sshDest, agent, plugins, refresh: today() }).pipe(
      Namespace.push(id),
    );
  }
});

const isPluginAgent = (agent: string): agent is PluginAgent => ["claude", "codex", "pi"].includes(agent);
