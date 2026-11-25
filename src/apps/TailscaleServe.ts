import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";

export interface ServeRule {
  /** HTTPS port on the tailnet name of the machine. Funnel permits only 443, 8443 and 10000. */
  port: number;
  /** Where the requests go, for example `http://127.0.0.1:38886`. */
  target: string;
  /** Make the port public on the internet. @default false */
  funnel?: boolean;
}

export interface TailscaleServeProps {
  /** SSH destination of the machine. */
  sshDest: string;
  rules: ServeRule[];
}

/**
 * The Serve rules that this stack owns, one for each HTTPS port. A rule that
 * leaves `rules` is turned off. Rules on other ports, which a person or a tool
 * made, stay as they are.
 */
export type TailscaleServe = Resource<"Tailscale.Serve", TailscaleServeProps, { ports: number[] }, never, Providers>;
export const TailscaleServe = Resource<TailscaleServe>("Tailscale.Serve");

const off = (ports: number[]) =>
  ports.map((port) => `sudo tailscale serve --https=${Number(port)} off || true\n`).join("");

const on = (rules: ServeRule[]) =>
  rules
    .map(
      ({ port, funnel }, index) =>
        `sudo tailscale ${funnel ? "funnel" : "serve"} --bg --https=${Number(port)} "$TARGET_${index}"\n`,
    )
    .join("");

export const TailscaleServeProvider = provider(TailscaleServe, {
  reconcile: Effect.fn(function* ({ news, output }) {
    const ports = news.rules.map((rule) => rule.port);
    // Turn each owned port off first: a port that changes from Funnel to tailnet must not stay public.
    const owned = [...new Set([...(output?.ports ?? []), ...ports])];
    const targets = Object.fromEntries(news.rules.map(({ target }, index) => [`TARGET_${index}`, target]));
    // A machine with no rules, now and before, has nothing to change.
    if (owned.length > 0) yield* runScript(news.sshDest, off(owned) + on(news.rules), targets);
    return { ports };
  }),
  delete: ({ olds, output }) => cleanUp(olds.sshDest, off(output.ports)),
});
