import type * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { type ServeRule, TailscaleServe } from "../apps/TailscaleServe.ts";
import { after, type Host } from "../host/Host.ts";
import { machineName } from "../host/index.ts";
import { TailscaleDevice, type TailscaleDeviceProps } from "./TailscaleDevice.ts";

/** A Serve rule that a component gives. The target can be an output of a resource. */
export type ServeRequest = { [Key in keyof ServeRule]: ServeRule[Key] | Output.Output<ServeRule[Key]> };

/** What `Tailnet` gives to the components that need the tailnet. */
export interface Tailnet {
  /** The machine, after it is a device in the tailnet. */
  host: Host;
  /** The machine as a device in the tailnet. */
  device: TailscaleDevice;
  /** The tags of the device. A second device of the machine gets the same tags. */
  tags: string[];
}

/**
 * The component for the tailnet: the machine as a device with the name of the
 * machine. `host` must have curl. Default: no tags, and Tailscale SSH on. To join, the provider makes a one-use auth
 * key with the Tailscale API (`TAILSCALE_API_KEY`).
 */
export const Tailnet = Effect.fn("Tincto.Tailnet")(function* (
  id: string,
  props: Partial<Pick<TailscaleDeviceProps, "tags" | "ssh">> & { host: Host },
) {
  const device = yield* TailscaleDevice(id, {
    sshDest: props.host.sshDest,
    hostname: yield* machineName,
    tags: props.tags ?? [],
    ssh: props.ssh ?? true,
  });
  return { host: after(props.host, device.nodeId), device, tags: props.tags ?? [] } satisfies Tailnet;
});

/**
 * The HTTPS ports of the machine in the tailnet. One machine has one `Serve`:
 * give it the rule of each component that has one (`t3code.serve`), and your own rules.
 * The stack owns only these ports: a rule that a person made on a different port stays.
 */
export const Serve = (id: string, props: { tailnet: Tailnet; rules: ServeRequest[] }) =>
  TailscaleServe(id, { sshDest: props.tailnet.host.sshDest, rules: props.rules });
