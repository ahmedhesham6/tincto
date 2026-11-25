import * as Namespace from "alchemy/Namespace";
import * as Effect from "effect/Effect";
import { after, type Host } from "../host/Host.ts";
import { GitHubLogin } from "./GitHubLogin.ts";
import { GitRepo } from "./GitRepo.ts";

/** The clone URL and the directory name for a source: a GitHub `owner/name`, or a full URL. */
export const repoSource = (source: string) => {
  const url = /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
  const name =
    url
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .pop() ?? source;
  return { url, name };
};

export interface ReposProps {
  /** The machine, with Git and the `gh` CLI. */
  host: Host;
  /** Copy the GitHub login of this computer (`gh auth token`) to the machine. The token is then stored there. Default: true. */
  githubLogin?: boolean;
  /** Directory for the clones, relative to the home directory. Default: `repos`. */
  dir?: string;
  /** A GitHub `owner/name`, or a full clone URL. */
  sources: string[];
}

/**
 * The component for your repositories: your GitHub login on the machine, and a
 * clone of each source. Each resource is below the ID of the component. Returns the clones.
 */
export const Repos = Effect.fn("Tincto.Repos")(function* (id: string, props: ReposProps) {
  const { host } = props;
  const login =
    (props.githubLogin ?? true)
      ? yield* GitHubLogin("GitHubLogin", { sshDest: host.sshDest }).pipe(Namespace.push(id))
      : undefined;
  // After the login, so that the clones and the login do not write the Git config at the same time.
  const ready = login ? after(host, login.user) : host;
  const clones = [];
  for (const source of props.sources) {
    const { url, name } = repoSource(source);
    const path = `${props.dir ?? "repos"}/${name}`;
    const clone = yield* GitRepo(name, { sshDest: ready.sshDest, url, path }).pipe(Namespace.push(id));
    // `cloned` is an output of the clone: a resource that needs the directory waits for it.
    clones.push({ name, path, cloned: clone.path });
  }
  return clones;
});

/** One repository of the machine, as the other components see it. */
export type Clone = Effect.Success<ReturnType<typeof Repos>>[number];
