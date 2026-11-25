import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runScript, uploadHome } from "../remote/Ssh.ts";

export interface HomeProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Local directory with the same layout as the home directory of the machine. */
  dir: string;
  /** Hash of the content of `dir`. A new hash copies the directory again. */
  hash: string;
  /** Paths, relative to the home directory, that this resource owns. */
  entries: string[];
}

/**
 * A set of files and directories in the home directory of the machine. The
 * resource owns each path in `entries`: a deploy replaces it, and it is removed
 * when the path leaves `entries` or the resource is destroyed.
 */
export type Home = Resource<"Agent.Home", HomeProps, { entries: string[] }, never, Providers>;
export const Home = Resource<Home>("Agent.Home");

export class HomeError extends Data.TaggedError("HomeError")<{ message: string }> {}

const remove = (sshDest: string, entries: string[]) =>
  Effect.gen(function* () {
    const unsafe = entries.find(
      (entry) => entry.startsWith("/") || entry.split("/").some((part) => part === ".." || part === ""),
    );
    if (unsafe !== undefined) {
      return yield* new HomeError({ message: `"${unsafe}" is not a path below the home directory` });
    }
    if (entries.length === 0) return;
    yield* runScript(sshDest, `while IFS= read -r entry; do rm -rf -- "$HOME/$entry"; done <<< "$ENTRIES"`, {
      ENTRIES: entries.join("\n"),
    });
  });

export const HomeProvider = provider(Home, {
  reconcile: Effect.fn(function* ({ news, olds }) {
    // Remove before the copy, so that a file deleted from a skill does not stay on the machine.
    yield* remove(news.sshDest, [...new Set([...(olds?.entries ?? []), ...news.entries])]);
    yield* uploadHome(news.sshDest, news.dir);
    return { entries: news.entries };
  }),
  // The machine can be gone already. Then there is nothing to remove.
  delete: ({ olds, output }) => remove(olds.sshDest, output.entries).pipe(Effect.ignore),
});
