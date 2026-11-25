import { expect, test as plainTest } from "bun:test";
import * as Test from "@alchemy.run/test/Bun";
import { adopt, Unowned } from "alchemy/AdoptPolicy";
import * as Effect from "effect/Effect";
import { ExeVm, ExeVmProvider, exeVmNameProblem } from "../src/host/ExeVm.ts";
import { ExeVmKey, publicKeyProblem } from "../src/host/ExeVmKey.ts";
import { providers } from "../src/Providers.ts";
import { lifecycle, scriptedShell } from "../src/testing.ts";

const ls = (...names: string[]) =>
  JSON.stringify({ vms: names.map((name) => ({ vm_name: name, ssh_dest: `${name}.exe.xyz`, status: "running" })) });
const attributes = { name: "box", sshDest: "box.exe.xyz" };

const shell = scriptedShell();
const { test } = Test.make({ providers: providers({ shell: shell.layer }) });

/** exe.dev with no VM `box` until a `new` command makes it. */
const makesBox = (line: string, calls: { line: string }[]) => {
  if (line.endsWith("ls --json"))
    return calls.some((call) => call.line.includes(" new ")) ? ls("other", "box") : ls("other");
  return "{}";
};

test.provider("ExeVm makes the VM with its size when exe.dev does not have it", (stack) =>
  Effect.gen(function* () {
    shell.script(makesBox);
    const news = { name: "box", image: "me/image:1", cpu: 8, memory: "16GB", disk: "40GB" };
    expect(yield* stack.deploy(ExeVm("Vm", news))).toEqual(attributes);
    // The first `ls` is the engine: it looks for a VM that is there already.
    expect(shell.lines()).toEqual([
      "ssh exe.dev ls --json",
      "ssh exe.dev ls --json",
      "ssh exe.dev new --name=box --image=me/image:1 --cpu=8 --memory=16GB --disk=40GB --json",
      "ssh exe.dev ls --json",
    ]);
  }),
);

test.provider("ExeVm refuses a VM that this stack did not make, and takes it with adopt", (stack) =>
  Effect.gen(function* () {
    shell.script(() => ls("box"));
    const error = yield* Effect.flip(stack.deploy(ExeVm("Vm", { name: "box" })));
    expect(String(error)).toContain("not owned by this stack");
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json"]);

    // With adopt, the stack takes the VM and does not make a new one.
    shell.script(() => ls("box"));
    expect(yield* stack.deploy(ExeVm("Vm", { name: "box" }).pipe(adopt(true)))).toEqual(attributes);
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json", "ssh exe.dev ls --json"]);
  }),
);

test.provider("ExeVm resizes a VM whose cpu or memory changed, and only then", (stack) =>
  Effect.gen(function* () {
    shell.script(makesBox);
    yield* stack.deploy(ExeVm("Vm", { name: "box", cpu: 2 }));

    shell.script(() => ls("box"));
    yield* stack.deploy(ExeVm("Vm", { name: "box", cpu: 8, memory: "16GB" }));
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json", "ssh exe.dev resize box --cpu=8 --memory=16GB"]);

    // A change of the disk runs the resource, but the size is the same.
    shell.script(() => ls("box"));
    yield* stack.deploy(ExeVm("Vm", { name: "box", cpu: 8, memory: "16GB", disk: "40GB" }));
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json"]);
  }),
);

test.provider("ExeVm reports the error that exe.dev prints as JSON", (stack) =>
  Effect.gen(function* () {
    shell.script((line) => (line.includes(" new ") ? JSON.stringify({ error: "Choose a plan" }) : ls()));
    const error = yield* Effect.flip(stack.deploy(ExeVm("Vm", { name: "box" })));
    expect(String(error)).toContain("Choose a plan");
  }),
);

test.provider("ExeVm reports an ssh failure, for example a key with no exe.dev account", (stack) =>
  Effect.gen(function* () {
    shell.script(() => ({ code: 1, stdout: "Please complete registration by running: ssh exe.dev" }));
    const error = yield* Effect.flip(stack.deploy(ExeVm("Vm", { name: "box" })));
    expect(String(error)).toContain("complete registration");
  }),
);

test.provider("ExeVm destroy removes the VM once, and does nothing when the VM is gone", (stack) =>
  Effect.gen(function* () {
    shell.script(makesBox);
    yield* stack.deploy(ExeVm("Vm", { name: "box" }));
    shell.script((line) => (line.endsWith("ls --json") ? ls("box") : ""));
    yield* stack.destroy();
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json", "ssh exe.dev rm box"]);

    shell.script(makesBox);
    yield* stack.deploy(ExeVm("Vm", { name: "box" }));
    shell.script(() => ls());
    yield* stack.destroy();
    expect(shell.lines()).toEqual(["ssh exe.dev ls --json"]);
  }),
);

// The engine calls `read` with an output only when it looks for drift, and the
// scratch stack of a test cannot start that. So this test calls the handler.
plainTest("read marks a VM that this stack did not make as not owned", async () => {
  const read = lifecycle<ExeVm>(ExeVm, ExeVmProvider, scriptedShell(() => ls("box")).layer).read;
  expect(Unowned.is(await read({ olds: { name: "box" } }))).toBe(true);
  const owned = await read({ olds: { name: "box" }, output: attributes });
  expect(owned).toEqual(attributes);
  expect(Unowned.is(owned)).toBe(false);
});

test.provider("ExeVm replaces the VM when the name or the image changes, and not when the size changes", (stack) =>
  Effect.gen(function* () {
    shell.script((line, calls) => {
      if (line.endsWith("ls --json")) return calls.some((call) => call.line.includes(" new ")) ? ls("box") : ls();
      return "{}";
    });
    yield* stack.deploy(ExeVm("Vm", { name: "box", cpu: 2 }));
    shell.script(() => ls());
    const action = (news: ExeVm["Props"]) =>
      stack.plan(ExeVm("Vm", news)).pipe(Effect.map((plan) => plan.resources.Vm?.action));
    expect(yield* action({ name: "other", cpu: 2 })).toBe("replace");
    expect(yield* action({ name: "box", cpu: 2, image: "x" })).toBe("replace");
    expect(yield* action({ name: "box", cpu: 8 })).toBe("update");
  }),
);

plainTest("exeVmNameProblem accepts the names that exe.dev accepts, and gives the reason for the others", () => {
  for (const name of ["tincto-box", "abcde", "a1-b2-c3"]) expect(exeVmNameProblem(name)).toBeUndefined();
  for (const name of ["box", "Tincto-box", "1tincto", "tincto--box", "tincto-", "tincto_box", "a".repeat(53)]) {
    expect(exeVmNameProblem(name)).toContain("not a valid exe.dev VM name");
  }
});

const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBp7 rola@mac";

/** An exe.dev account with the key of the owner, and the keys that `ssh-key add` gives it. */
const account = () => {
  const keys = [{ public_key: "ssh-rsa AAAAowner key-1", fingerprint: "SHA256:owner" }];
  shell.script((line) => {
    if (line.includes("ssh-key add")) keys.push({ public_key: publicKey, fingerprint: "SHA256:rola" });
    if (line.includes("ssh-key remove")) keys.splice(1);
    return JSON.stringify({ ssh_keys: keys });
  });
  return keys;
};

test.provider("ExeVmKey adds the key for one VM only, one time, and destroy removes it", (stack) =>
  Effect.gen(function* () {
    const keys = account();
    const news = { vm: "box", publicKey };
    expect(yield* stack.deploy(ExeVmKey("Key", news))).toEqual({ fingerprint: "SHA256:rola" });
    expect(shell.lines()).toEqual([
      "ssh exe.dev ssh-key list --json",
      `ssh exe.dev ssh-key add --vm=box '${publicKey}'`,
      "ssh exe.dev ssh-key list --json",
    ]);

    // The key is there already, so a second deploy adds nothing.
    yield* stack.deploy(ExeVmKey("Key", news), { force: true });
    expect(shell.lines().filter((line) => line.includes("ssh-key add"))).toHaveLength(1);

    yield* stack.destroy();
    expect(shell.lines().at(-1)).toBe("ssh exe.dev ssh-key remove SHA256:rola");
    expect(keys).toHaveLength(1);
  }),
);

test.provider("ExeVmKey does not take a key that the stack did not add, such as the key of the owner", (stack) =>
  Effect.gen(function* () {
    account();
    const error = yield* Effect.flip(stack.deploy(ExeVmKey("Key", { vm: "box", publicKey: "ssh-rsa AAAAowner me" })));
    expect(String(error)).toContain("is in your exe.dev account already");
    expect(shell.lines()).toEqual(["ssh exe.dev ssh-key list --json"]);
  }),
);

test.provider("ExeVmKey replaces the key when the VM or the public key changes", (stack) =>
  Effect.gen(function* () {
    account();
    yield* stack.deploy(ExeVmKey("Key", { vm: "box", publicKey }));
    const action = (news: ExeVmKey["Props"]) =>
      stack.plan(ExeVmKey("Key", news)).pipe(Effect.map((plan) => plan.resources.Key?.action));
    expect(yield* action({ vm: "other", publicKey })).toBe("replace");
    expect(yield* action({ vm: "box", publicKey: "ssh-ed25519 AAAAother rola@mac" })).toBe("replace");
  }),
);

plainTest("publicKeyProblem accepts one line of a .pub file, and refuses text that a shell reads", () => {
  for (const key of [publicKey, "ssh-ed25519 AAAAC3Nz", "ssh-rsa AAAAB3Nz+/a== me@host.example"]) {
    expect(publicKeyProblem(key)).toBeUndefined();
  }
  for (const key of [
    "",
    "AAAAC3Nz",
    "ssh-ed25519 AAAA' ; rm box ; '",
    "ssh-ed25519 AAAA\nssh-rsa BBBB",
    "ssh-ed25519 AAAA two words",
  ]) {
    expect(publicKeyProblem(key)).toContain("is not a public key");
  }
});
