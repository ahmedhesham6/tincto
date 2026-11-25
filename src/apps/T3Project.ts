import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runScript } from "../remote/Ssh.ts";

export interface T3ProjectProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Directory of the project, relative to the home directory, for example `repos/tincto`. */
  path: string;
  /** Name of the project in T3 Code. */
  title: string;
}

/**
 * A project in the T3 Code server of the machine, for one directory. The
 * resource adds the project when T3 Code does not have it. Destroy leaves the
 * project: T3 Code keeps your threads in it.
 */
export type T3Project = Resource<"App.T3Project", T3ProjectProps, { path: string }, never, Providers>;
export const T3Project = Resource<T3Project>("App.T3Project");

// T3 Code fails when it has the project already. That is the wanted result, so it is not an error here.
const add = `
if ! out="$(T3CODE_HOME="$HOME/.t3" t3 project add "$HOME/$PROJECT_PATH" --title "$TITLE" 2>&1)"; then
  if ! grep -q ProjectAlreadyExistsError <<< "$out"; then
    echo "$out" >&2
    exit 1
  fi
fi
`;

export const T3ProjectProvider = provider(T3Project, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, add, { PROJECT_PATH: news.path, TITLE: news.title });
    return { path: news.path };
  }),
  delete: () => Effect.void,
});
