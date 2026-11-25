import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";
import * as userService from "../remote/userService.ts";

export interface BbServerProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Version of the `bb-app` tool on the machine. The script does not read it: a new version restarts the server. */
  version: string;
  /** Loopback port of the server. */
  port: number;
  /** Address at which browsers and other machines reach the server, for example the Tailscale Serve URL. */
  url: string;
}

export interface BbServerAttributes {
  /** Loopback address, for a Serve rule. */
  localUrl: string;
  url: string;
}

/**
 * A bb server as a systemd user service on the machine. The toolchain gives
 * the version, so the server runs with in-app updates off. Destroy stops the
 * service and keeps the data in `~/.bb`.
 */
export type BbServer = Resource<"Bb.Server", BbServerProps, BbServerAttributes, never, Providers>;
export const BbServer = Resource<BbServer>("Bb.Server");

const install =
  userService.writeUnit(
    "bb-app",
    "bb app server",
    "$HOME/.local/share/mise/shims/bb-app --no-in-app-updates --server-port $PORT",
  ) +
  `bb-app config set BB_APP_URL "$URL"\n` +
  userService.start("bb-app") +
  userService.waitForPort("bb-app", "$PORT");

export const BbServerProvider = provider(BbServer, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, install, { PORT: String(news.port), URL: news.url });
    return { localUrl: `http://127.0.0.1:${news.port}`, url: news.url };
  }),
  delete: ({ olds }) => cleanUp(olds.sshDest, userService.remove("bb-app")),
});
