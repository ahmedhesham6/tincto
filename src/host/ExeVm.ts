import { Unowned } from "alchemy/AdoptPolicy";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider, replaceOn } from "../remote/provider.ts";
import { lobby } from "../remote/Ssh.ts";

export interface ExeVmProps {
  /** VM name. exe.dev names are global, and the name is the host: `<name>.exe.xyz`. */
  name: string;
  /** OCI image. exe.dev uses its `exeuntu` image when you omit this. */
  image?: string;
  /** Number of vCPUs. exe.dev uses the default of your account when you omit this. */
  cpu?: number;
  /** Memory, for example `16GB`. */
  memory?: string;
  /** Disk, for example `40GB`. Used only when the VM is made. */
  disk?: string;
}

export interface ExeVmAttributes {
  name: string;
  /** Destination for `ssh` and `scp`, as exe.dev reports it. */
  sshDest: string;
}

/** An exe.dev VM. A change of `name` or `image` replaces the VM. A change of `cpu` or `memory` resizes it. */
export type ExeVm = Resource<"Exe.Vm", ExeVmProps, ExeVmAttributes, never, Providers>;
export const ExeVm = Resource<ExeVm>("Exe.Vm");

/**
 * The rule of exe.dev for a VM name, and the reason when a name breaks it.
 * `ExeHost` uses it, so a bad name stops the plan and not the deploy.
 */
export const exeVmNameProblem = (name: string) =>
  name.length >= 5 && name.length <= 52 && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)
    ? undefined
    : `"${name}" is not a valid exe.dev VM name. It must have 5 to 52 characters: a lowercase letter first, then lowercase letters or digits, with single hyphens between them (for example tincto-box).`;

export class ExeError extends Data.TaggedError("ExeError")<{ message: string }> {}

const parse = (stdout: string, command: string) =>
  Effect.try({
    try: () => JSON.parse(stdout) as { error?: string; vms?: { vm_name: string; ssh_dest: string }[] },
    catch: () => new ExeError({ message: `exe.dev ${command} did not print JSON: ${stdout.slice(0, 500)}` }),
  }).pipe(
    Effect.flatMap((json) =>
      json.error ? Effect.fail(new ExeError({ message: `exe.dev ${command}: ${json.error}` })) : Effect.succeed(json),
    ),
  );

const find = (name: string) =>
  lobby("ls", "--json").pipe(
    Effect.flatMap((result) => parse(result.stdout, "ls")),
    Effect.map((json): ExeVmAttributes | undefined => {
      const vm = json.vms?.find((entry) => entry.vm_name === name);
      return vm && { name: vm.vm_name, sshDest: vm.ssh_dest };
    }),
  );

const size = (props: ExeVmProps) => [
  ...(props.cpu ? [`--cpu=${props.cpu}`] : []),
  ...(props.memory ? [`--memory=${props.memory}`] : []),
];

export const ExeVmProvider = provider(ExeVm, {
  stables: ["name", "sshDest"],
  diff: replaceOn<ExeVmProps>("name", "image"),
  // A VM that this stack did not make is not ours: the engine then asks for --adopt.
  read: Effect.fn(function* ({ olds, output }) {
    const vm = yield* find(output?.name ?? olds.name);
    return vm && (output ? vm : Unowned(vm));
  }),
  reconcile: Effect.fn(function* ({ news, olds }) {
    const observed = yield* find(news.name);
    if (observed) {
      if (olds && (olds.cpu !== news.cpu || olds.memory !== news.memory)) {
        yield* lobby("resize", news.name, ...size(news));
      }
      return observed;
    }
    const created = yield* lobby(
      "new",
      `--name=${news.name}`,
      ...(news.image ? [`--image=${news.image}`] : []),
      ...size(news),
      ...(news.disk ? [`--disk=${news.disk}`] : []),
      "--json",
    );
    yield* parse(created.stdout, "new");
    const vm = yield* find(news.name);
    if (!vm) return yield* new ExeError({ message: `exe.dev made ${news.name}, but ls does not show it` });
    return vm;
  }),
  delete: Effect.fn(function* ({ output }) {
    if (yield* find(output.name)) yield* lobby("rm", output.name);
  }),
});
