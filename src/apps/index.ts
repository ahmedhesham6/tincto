import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { after } from "../host/Host.ts";
import { machineName } from "../host/index.ts";
import type { ServeRequest, Tailnet } from "../network/index.ts";
import type { Clone } from "../repos/index.ts";
import { type Tools, toolVersion } from "../toolchain/index.ts";
import { BbMachine as BbMachineResource } from "./BbMachine.ts";
import { BbPlugin } from "./BbPlugin.ts";
import { BbServer as BbServerResource } from "./BbServer.ts";
import { T3Code as T3CodeResource } from "./T3Code.ts";
import { T3Project } from "./T3Project.ts";

/** A short name for a plugin source: the repository or package name, with no version. */
export const pluginName = (source: string) =>
  (
    source
      .replace(/@[^@/]*$/, "")
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .pop() ?? source
  ).replace(/[^A-Za-z0-9-]+/g, "-");

// The components of the app layer. A stack yields the ones that the machine has.
// A component has an ID, as a resource has: its main resource has that ID, and its other resources are below it.
// A component takes what it needs as props, and returns what the stack or a different component can use.

const address = (tailnet: Tailnet, port: number) => Output.interpolate`https://${tailnet.device.dnsName}:${port}`;

/**
 * The T3 Code server. Each clone in `projects` is a project in T3 Code. Needs
 * the tool `npm:t3`. Give `serve` to `Serve`: the T3 Code app reaches the server on `servePort`.
 */
export const T3Code = Effect.fn("Tincto.T3Code")(function* (
  id: string,
  props: {
    tools: Tools;
    tailnet: Tailnet;
    /** Default: 3999. */
    port?: number;
    /** HTTPS port in the tailnet. Default: 9443. */
    servePort?: number;
    projects?: Clone[];
    /** `false` stops the product usage events and the relay traces of the server. Default: the default of T3 Code. */
    telemetry?: boolean;
  },
) {
  const { host } = props.tools;
  const { port = 3999, servePort = 9443 } = props;
  const url = address(props.tailnet, servePort);
  const t3code = yield* T3CodeResource(id, {
    sshDest: host.sshDest,
    version: yield* toolVersion(props.tools, "npm:t3", "T3Code"),
    host: props.tailnet.device.ipv4,
    port,
    publicUrl: url,
    // No key when there is no value: a machine from before this prop then has no change.
    ...(props.telemetry === undefined ? {} : { telemetry: props.telemetry }),
  });
  for (const { name, path, cloned } of props.projects ?? []) {
    // After the service and the clone: T3 Code refuses a directory that is not there.
    const projectHost = after(host, t3code.url, cloned);
    yield* T3Project(`Project-${name}`, { sshDest: projectHost.sshDest, path, title: name }).pipe(Namespace.push(id));
  }
  return {
    /** Address of the server in the tailnet. */
    url,
    /** A link that pairs a T3 Code app with the server. Open it within one hour. */
    pairUrl: t3code.pairUrl,
    serve: { port: servePort, target: t3code.url } satisfies ServeRequest,
  };
});

/**
 * A bb server on the machine, with its plugins. Needs the tool `npm:bb-app`.
 * Give `serve` to `Serve`. `funnel: true` makes the server public on the internet.
 */
export const BbServer = Effect.fn("Tincto.BbServer")(function* (
  id: string,
  props: {
    tools: Tools;
    tailnet: Tailnet;
    /** Default: 38886. */
    port?: number;
    /** HTTPS port in the tailnet. Default: 8443. */
    servePort?: number;
    /** Default: false. */
    funnel?: boolean;
    /** Default: none. */
    plugins?: string[];
  },
) {
  const { host } = props.tools;
  const { port = 38886, servePort = 8443, funnel = false, plugins = [] } = props;
  const server = yield* BbServerResource(id, {
    sshDest: host.sshDest,
    version: yield* toolVersion(props.tools, "npm:bb-app", "BbServer"),
    port,
    url: address(props.tailnet, servePort),
  });
  // After the server: `bb plugin install` talks to it.
  const serverUp = after(host, server.url);
  for (const source of plugins) {
    yield* BbPlugin(`Plugin-${pluginName(source)}`, { sshDest: serverUp.sshDest, source }).pipe(Namespace.push(id));
  }
  return {
    url: server.url,
    serve: { port: servePort, target: server.localUrl, funnel } satisfies ServeRequest,
  };
});

/**
 * The machine joins a bb server as a bb machine, with the name of the machine.
 * `serverSsh` is the SSH destination of the computer that runs the server. Omit
 * it when the server is on the computer that runs the deploy. Needs the tool `npm:bb-app`.
 */
export const BbMachine = Effect.fn("Tincto.BbMachine")(function* (
  id: string,
  props: { tools: Tools; serverSsh?: string },
) {
  yield* toolVersion(props.tools, "npm:bb-app", "BbMachine");
  const machine = yield* BbMachineResource(id, {
    name: yield* machineName,
    sshDest: props.tools.host.sshDest,
    serverSsh: props.serverSsh,
  });
  return { hostId: machine.hostId };
});
