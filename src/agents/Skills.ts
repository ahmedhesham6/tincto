import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";

export interface SkillsProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /**
   * Skill source and the names of the skills to install from it. A source is
   * what `skills add` accepts, for example the GitHub repository `mattpocock/skills`.
   */
  sources: Record<string, string[]>;
  /** Agent names as the `skills` CLI knows them, for example `claude-code`. */
  agents: string[];
  /** A new value makes the resource run again, so that the skills move to the newest version. */
  refresh?: string;
}

/**
 * Skills from skill sources, installed on the machine by the `skills` CLI
 * (https://github.com/vercel-labs/skills). The repository does not hold a copy.
 * A skill that leaves `sources` is removed from the machine. One resource holds
 * all sources: the CLI keeps one lock file, so two installs must not run at the same time.
 */
export type Skills = Resource<"Agent.Skills", SkillsProps, { skills: string[] }, never, Providers>;
export const Skills = Resource<Skills>("Agent.Skills");

export class SkillsError extends Data.TaggedError("SkillsError")<{ message: string }> {}

// A name goes into a shell command, so only plain names are permitted.
const checked = (values: string[], pattern = /^[A-Za-z0-9@._-]+$/): Effect.Effect<string[], SkillsError> => {
  const bad = values.find((value) => !pattern.test(value));
  return bad === undefined
    ? Effect.succeed(values)
    : Effect.fail(new SkillsError({ message: `"${bad}" is not a valid skill, agent or source name.` }));
};
const flags = (flag: string, values: string[]) => values.map((value) => `${flag} "${value}"`).join(" ");
const removeScript = (skills: string[]) => `skills remove --global --yes ${flags("--skill", skills)}\n`;

const installScript = (props: SkillsProps, removed: string[]) =>
  Effect.gen(function* () {
    const names = Object.values(props.sources).flat();
    yield* checked([...names, ...removed, ...props.agents]);
    yield* checked(Object.keys(props.sources), /^[A-Za-z0-9@._:/-]+$/);
    const adds = Object.entries(props.sources).map(
      ([source, skills]) =>
        `skills add "${source}" --global --yes ${flags("--agent", props.agents)} ${flags("--skill", skills)}\n`,
    );
    return (removed.length > 0 ? removeScript(removed) : "") + adds.join("") + "skills update --global --yes\n";
  });

export const SkillsProvider = provider(Skills, {
  reconcile: Effect.fn(function* ({ news, output }) {
    const wanted = Object.values(news.sources).flat();
    const removed = (output?.skills ?? []).filter((name) => !wanted.includes(name));
    yield* runScript(news.sshDest, yield* installScript(news, removed));
    return { skills: wanted };
  }),
  delete: ({ olds, output }) =>
    output.skills.length === 0
      ? Effect.void
      : checked(output.skills).pipe(
          Effect.flatMap((skills) => cleanUp(olds.sshDest, removeScript(skills))),
          Effect.ignore,
        ),
});
