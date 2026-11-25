import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { Shell } from "../remote/Shell.ts";
import { runScript } from "../remote/Ssh.ts";

export interface GitRepoProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Clone URL, for example `https://github.com/owner/name.git`. */
  url: string;
  /** Where the clone goes, relative to the home directory, for example `repos/name`. */
  path: string;
}

/**
 * A clone of a Git repository on the machine. The resource makes the clone
 * when the directory is not there, and then never touches it: your branches
 * and changes are yours. Destroy leaves the clone for the same reason.
 */
export type GitRepo = Resource<"Repo.Git", GitRepoProps, { path: string }, never, Providers>;
export const GitRepo = Resource<GitRepo>("Repo.Git");

export class GitRepoError extends Data.TaggedError("GitRepoError")<{ message: string }> {}

/**
 * The GitHub token of the computer that runs the stack, from the `gh` CLI. With
 * it, a private repository clones before a person logs in on the machine. No
 * token is not an error: public repositories do not need one.
 */
const githubToken = Effect.gen(function* () {
  const shell = yield* Shell;
  const result = yield* shell.run("gh", ["auth", "token"]).pipe(Effect.orElseSucceed(() => undefined));
  return result?.code === 0 ? result.stdout.trim() : "";
});

// `git -c` before `clone` gives the token to this one command only. It is not written on the machine.
const clone = `
dir="$HOME/$REPO_PATH"
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$(dirname "$dir")"
  if [ -n "$GITHUB_TOKEN" ]; then
    basic="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\\n')"
    git -c "http.https://github.com/.extraheader=Authorization: Basic $basic" clone "$URL" "$dir"
  else
    git clone "$URL" "$dir"
  fi
fi
`;

export const GitRepoProvider = provider(GitRepo, {
  reconcile: Effect.fn(function* ({ news }) {
    if (news.path.startsWith("/") || news.path.split("/").some((part) => part === ".." || part === "")) {
      return yield* new GitRepoError({ message: `"${news.path}" is not a path below the home directory` });
    }
    const token = news.url.startsWith("https://github.com/") ? yield* githubToken : "";
    yield* runScript(news.sshDest, clone, { REPO_PATH: news.path, URL: news.url, GITHUB_TOKEN: token });
    return { path: news.path };
  }),
  delete: () => Effect.void,
});
