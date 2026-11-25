import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AgentsConfig } from "./index.ts";

/** Where all skills go on the machine. Each agent gets links into this directory. */
export const skillStore = ".agents/skills";

export interface Staged {
  /** Local directory with the same layout as the home directory of the machine. */
  dir: string;
  /** Hash of all paths, links and file contents in `dir`. */
  hash: string;
  /** The paths, relative to the home directory, that this project owns. */
  entries: string[];
}

/**
 * Builds the home directory tree that the config describes, from the files in
 * `root` (machine/): each custom skill once in the skill store, a link for each
 * agent that lists the skill, the files of each agent, and the home files.
 */
export const stageAgents = (config: Pick<AgentsConfig, "agents" | "home">, root: string, dir: string): Staged => {
  rmSync(dir, { recursive: true, force: true });
  // A machine with no files and no custom skills has an empty tree.
  mkdirSync(dir, { recursive: true });
  const entries = new Set<string>();
  const put = (entry: string, write: (target: string) => void) => {
    if (entries.has(entry)) return;
    entries.add(entry);
    mkdirSync(dirname(join(dir, entry)), { recursive: true });
    write(join(dir, entry));
  };
  const skill = (name: string) => {
    const source = join(root, "skills", name);
    if (!existsSync(join(source, "SKILL.md")))
      throw new Error(`The machine file names the skill "${name}", but machine/skills/${name}/SKILL.md is not there.`);
    put(join(skillStore, name), (target) => cpSync(source, target, { recursive: true }));
  };

  const file = (source: string, destination: string) => {
    if (!existsSync(join(root, source)))
      throw new Error(`The machine file names machine/${source}, but the file is not there.`);
    put(destination, (target) => cpSync(join(root, source), target));
  };

  for (const [name, destination] of Object.entries(config.home)) file(join("home", name), destination);
  for (const [agent, { files, skillsDir, skills }] of Object.entries(config.agents)) {
    for (const [name, destination] of Object.entries(files)) file(join("agents", agent, name), destination);
    for (const name of skills) {
      skill(name);
      if (skillsDir !== skillStore) {
        put(join(skillsDir, name), (target) =>
          symlinkSync(relative(dirname(target), join(dir, skillStore, name)), target),
        );
      }
    }
  }

  const hash = createHash("sha256");
  const all = readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((entry) => ({ entry, path: join(entry.parentPath, entry.name) }))
    .toSorted((a, b) => (a.path < b.path ? -1 : 1));
  for (const { entry, path } of all) {
    hash.update(path.slice(dir.length));
    if (entry.isSymbolicLink()) hash.update(readlinkSync(path));
    else if (entry.isFile()) hash.update(readFileSync(path));
  }
  return { dir, hash: hash.digest("hex"), entries: [...entries].toSorted() };
};
