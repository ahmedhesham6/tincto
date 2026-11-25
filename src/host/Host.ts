import type { Input } from "alchemy";
import * as Output from "alchemy/Output";

/**
 * What the host layer gives to each other layer: a machine that accepts SSH.
 * The other layers know nothing more about the machine.
 */
export interface Host {
  /** Destination for `ssh`, for example `box.exe.xyz` or `dev@10.0.0.5`. */
  sshDest: Input<string>;
}

/**
 * The same host, for use only after other resources are done. Give it an
 * output of each resource to wait for. A resource that gets this host runs
 * after them: this is how the stack states run order.
 */
export const after = (host: Host, ...done: Output.Output<unknown>[]): Host => {
  const sshDest = (
    Output.isOutput(host.sshDest) ? host.sshDest : Output.literal(host.sshDest)
  ) as Output.Output<string>;
  return { sshDest: Output.all(sshDest, ...done).pipe(Output.map((values) => values[0] as string)) };
};
