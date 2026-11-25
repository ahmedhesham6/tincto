import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { ExeVm, type ExeVmProps, exeVmNameProblem } from "./ExeVm.ts";
import type { Host } from "./Host.ts";

/** The name of the machine: the name of the stack. The components use it for the names that they give. */
export const machineName = Alchemy.Stack.use((stack) => Effect.succeed(stack.name));

/**
 * An exe.dev VM as the host. The VM has the name of the machine (the name is
 * global: `<name>.exe.xyz`). A bad name stops the plan.
 * For a machine that exists, no component is necessary: the host is `{ sshDest: "user@host" }`.
 */
export const ExeHost = Effect.fn("Tincto.ExeHost")(function* (id: string, props: Omit<ExeVmProps, "name">) {
  const name = yield* machineName;
  const problem = exeVmNameProblem(name);
  if (problem) return yield* Effect.die(new Error(`${problem} Change the name of the stack.`));
  const vm = yield* ExeVm(id, { name, ...props });
  return { sshDest: vm.sshDest } satisfies Host;
});
