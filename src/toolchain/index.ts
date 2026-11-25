import * as Namespace from "alchemy/Namespace";
import * as Effect from "effect/Effect";
import { after, type Host } from "../host/Host.ts";
import { ShellLive } from "../remote/Shell.ts";
import { AptPackages } from "./AptPackages.ts";
import { Mise } from "./Mise.ts";
import { SystemService } from "./SystemService.ts";
import { resolveTools } from "./versions.ts";

export interface ToolchainConfig {
  /** apt packages. Default: curl, ca-certificates, git and unzip, which the tools of tincto need. */
  apt?: string[];
  /** systemd system services to enable, for example `docker`. Default: none. */
  services?: string[];
  /**
   * Tool and version, as mise names them. A version is exact or open, and an
   * `npm:` version can be an npm tag. A component that needs a tool names it: T3 Code
   * needs `npm:t3`, bb needs `npm:bb-app`, the agents need `npm:skills`. Default: none.
   */
  tools?: Record<string, string>;
  /** How old a release must be before mise installs it for an open version. Default: `0s`, at once. `24h` is one day. */
  minimumReleaseAge?: string;
}

/** What `Toolchain` gives to the components that need tools. */
export interface Tools {
  /** The machine after the apt packages. For a component that needs only curl. */
  base: Host;
  /** The machine after all tools and services. */
  host: Host;
  /** Each tool with its version. An npm tag is an exact version here. */
  versions: Record<string, string>;
}

/**
 * The component for tools: apt packages, system services, and the mise tools. The
 * mise tools have the ID of the component, and the other resources are below it.
 */
export const Toolchain = Effect.fn("Tincto.Toolchain")(function* (id: string, props: ToolchainConfig & { host: Host }) {
  const { host } = props;
  const apt = yield* AptPackages("Apt", {
    sshDest: host.sshDest,
    packages: props.apt ?? ["curl", "ca-certificates", "git", "unzip"],
  }).pipe(Namespace.push(id));
  const base = after(host, apt.packages);

  const services = [];
  for (const name of props.services ?? []) {
    services.push(yield* SystemService(`Service-${name}`, { sshDest: base.sshDest, name }).pipe(Namespace.push(id)));
  }
  const { tools, refresh } = yield* resolveTools(props.tools ?? {}).pipe(Effect.provide(ShellLive), Effect.orDie);
  const mise = yield* Mise(id, {
    sshDest: base.sshDest,
    tools,
    minimumReleaseAge: props.minimumReleaseAge ?? "0s",
    refresh,
  });

  const ready = after(base, mise.tools, ...services.map((service) => service.name));
  return { base, host: ready, versions: tools } satisfies Tools;
});

/** The version of a tool that a component needs. A machine with no such tool stops the plan. */
export const toolVersion = (tools: Tools, tool: string, component: string) =>
  tools.versions[tool] === undefined
    ? Effect.die(new Error(`${component} needs the tool "${tool}". Add it to the tools of Toolchain.`))
    : Effect.succeed(tools.versions[tool]);
