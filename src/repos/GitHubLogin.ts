import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runOk } from "../remote/Shell.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";

export interface GitHubLoginProps {
  /** SSH destination of the machine. */
  sshDest: string;
}

/**
 * Your GitHub login on the machine: `gh` and Git over HTTPS work there with no
 * prompt. The resource copies the token of the `gh` CLI of the computer that
 * runs the stack. The token is on the machine after that, in the config of
 * `gh`. It is not in the state of Alchemy. Destroy logs out on the machine.
 *
 * The resource runs one time. Run a deploy with `--force` to copy a new token.
 */
export type GitHubLogin = Resource<"Repo.GitHubLogin", GitHubLoginProps, { user: string }, never, Providers>;
export const GitHubLogin = Resource<GitHubLogin>("Repo.GitHubLogin");

export class GitHubLoginError extends Data.TaggedError("GitHubLoginError")<{ message: string }> {}

// The token goes to gh through stdin. Its variable is not GITHUB_TOKEN: gh stores no login when that one is set.
// Git gets it from gh: see the credential helper in machine/home/gitconfig.
const login = `
gh auth login --hostname github.com --with-token <<< "$TOKEN"
gh api user --jq .login
`;

export const GitHubLoginProvider = provider(GitHubLogin, {
  reconcile: Effect.fn(function* ({ news }) {
    const token = yield* runOk("gh", ["auth", "token"]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.mapError(
        () => new GitHubLoginError({ message: "This computer has no GitHub login. Run `gh auth login` here first." }),
      ),
    );
    const result = yield* runScript(news.sshDest, login, { TOKEN: token });
    return { user: result.stdout.trim().split("\n").pop() ?? "" };
  }),
  delete: ({ olds }) => cleanUp(olds.sshDest, "gh auth logout --hostname github.com"),
});
