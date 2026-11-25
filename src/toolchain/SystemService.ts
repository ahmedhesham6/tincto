import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";

export interface SystemServiceProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Name of a systemd system unit that the machine has, for example `docker`. */
  name: string;
}

/** A systemd system service that is enabled and running, for example the Docker daemon. */
export type SystemService = Resource<"Toolchain.SystemService", SystemServiceProps, { name: string }, never, Providers>;
export const SystemService = Resource<SystemService>("Toolchain.SystemService");

export const SystemServiceProvider = provider(SystemService, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, `sudo systemctl enable --now "$NAME"`, { NAME: news.name });
    return { name: news.name };
  }),
  delete: ({ olds }) => cleanUp(olds.sshDest, `sudo systemctl disable --now "$NAME"`, { NAME: olds.name }),
});
