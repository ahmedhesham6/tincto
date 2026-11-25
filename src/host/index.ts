import * as Alchemy from "alchemy";
import * as Namespace from "alchemy/Namespace";
import * as Effect from "effect/Effect";
import { ExeVm, type ExeVmProps, exeVmNameProblem } from "./ExeVm.ts";
import { ExeVmKey, publicKeyProblem } from "./ExeVmKey.ts";
import type { Host } from "./Host.ts";

/** The name of the machine: the name of the stack. The components use it for the names that they give. */
export const machineName = Alchemy.Stack.use((stack) => Effect.succeed(stack.name));

/**
 * An exe.dev VM as the host. The VM has the name of the machine (the name is
 * global: `<name>.exe.xyz`). A bad name stops the plan.
 * `sshKeys` lets other persons connect with `ssh <name>.exe.xyz`: the key is a name
 * for the person, and the value is their public key. A key opens this VM only, and
 * the person needs no exe.dev account. Default: none.
 * For a machine that exists, no component is necessary: the host is `{ sshDest: "user@host" }`.
 */
export const ExeHost = Effect.fn("Tincto.ExeHost")(function* (
  id: string,
  props: Omit<ExeVmProps, "name"> & { sshKeys?: Record<string, string> },
) {
  const name = yield* machineName;
  const { sshKeys = {}, ...size } = props;
  const problem = exeVmNameProblem(name) ?? Object.values(sshKeys).map(publicKeyProblem).find(Boolean);
  if (problem) return yield* Effect.die(new Error(`${problem} Change the machine file.`));
  const vm = yield* ExeVm(id, { name, ...size });
  for (const [person, publicKey] of Object.entries(sshKeys)) {
    // The name of the VM is an output of the VM, so the key waits for it.
    yield* ExeVmKey(`Key-${person}`, { vm: vm.name, publicKey }).pipe(Namespace.push(id));
  }
  return { sshDest: vm.sshDest } satisfies Host;
});
