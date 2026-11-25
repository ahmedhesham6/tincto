# tincto

The components of a dev environment on a machine, for [Alchemy](https://alchemy.run):
the tools, the tailnet, the agents with their skills, your repositories and the
apps. You select the components. Each one is a set of Alchemy resources written with Effect.

Tincto is Latin for "I tinge". In alchemy, the tincture is the substance that changes a base metal into gold. Here it changes a bare server into a ready machine.

tincto is built on Alchemy, and it is only components. You write a normal Alchemy
stack and yield the components that the machine must have. All of Alchemy works
as it does in each other stack: `alchemy deploy`, stages, references, your own
resources, and the resources of other packages. `Tincto.providers()` is the
provider layer, as `Cloudflare.providers()` is for Cloudflare.

tincto runs with [Bun](https://bun.sh). The package has TypeScript source, with no build step.

## Install

```sh
bun add tincto alchemy effect
```

## A machine

One file is the stack of one machine. The name of the stack is the name of the
machine. The machine has each component that the stack yields, and no other component.

```ts
// machines/my-box.ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Tincto from "tincto";

export default Alchemy.Stack(
  "my-box",
  { providers: Tincto.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    // An exe.dev VM. For a machine that exists: const host = { sshDest: "user@host" };
    const host = yield* Tincto.ExeHost("Vm", { cpu: 2, memory: "8GB", disk: "50GB" });

    // mise installs the tools. T3Code needs npm:t3, and Agents needs npm:skills.
    const tools = yield* Tincto.Toolchain("Tools", {
      host,
      tools: { node: "24", gh: "latest", claude: "latest", "npm:skills": "latest", "npm:t3": "nightly" },
    });
    const tailnet = yield* Tincto.Tailnet("Tailscale", { host: tools.base });

    // Files from machine/agents/<agent>/ of your project, and where they go.
    yield* Tincto.Agents("Home", {
      tools,
      agents: { claude: { files: { "CLAUDE.md": ".claude/CLAUDE.md" }, skillsDir: ".claude/skills", skills: [] } },
    });

    const clones = yield* Tincto.Repos("Repos", { host: tools.host, sources: ["me/project"] });
    const t3code = yield* Tincto.T3Code("T3Code", { tools, tailnet, projects: clones });
    yield* Tincto.Serve("Serve", { tailnet, rules: [t3code.serve] });

    // What the deploy prints.
    return { ssh: host.sshDest, t3code: t3code.url, t3codePair: t3code.pairUrl };
  }),
);
```

Each component has a default for each value that it can: only `host`, `tools`
or `tailnet`, and the list of repositories, are necessary above.

```sh
bunx alchemy plan machines/my-box.ts      # show what a deploy will change
bunx alchemy deploy machines/my-box.ts    # make or update the machine
bunx alchemy destroy machines/my-box.ts   # remove the VM, the tailnet device and the services
```

Run the commands in the root of your project. `Agents` reads `machine/` there,
and Alchemy keeps its state in `.alchemy/` there. Each machine is a stack of
its own, so a deploy of one machine does not change a different one.

A small machine is a small file. This one only clones a repository on a server that you have:

```ts
export default Alchemy.Stack(
  "tiny-box",
  { providers: Tincto.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const host = { sshDest: "me@my-server" };
    yield* Tincto.Repos("Repos", { host, githubLogin: false, sources: ["me/project"] });
  }),
);
```

The host can be a server of a different Alchemy package. A host is only an SSH
destination, so each server that accepts SSH with your key works:

```ts
import * as Hetzner from "@alchemy.run/hetzner";
import * as Output from "alchemy/Output";

// providers: Layer.mergeAll(Tincto.providers(), Hetzner.providers())
const key = yield * Hetzner.SshKey("laptop", { publicKey: "ssh-ed25519 AAAA... you@laptop" });
const server = yield * Hetzner.Server("box", { serverType: "cx22", image: "ubuntu-24.04", sshKeys: [key] });
const host: Tincto.Host = { sshDest: Output.interpolate`root@${server.ipv4}` };
```

### A machine that a different tool manages

On some machines a different tool owns the system: NixOS, or the setup of your
company. That tool installs the tools and joins the tailnet, and `sudo` asks for
a password, so a script cannot use it. Do not yield `Toolchain` there: give the
tools that the machine has. `join: false` makes `Tailnet` read the device only.

```ts
const host = { sshDest: "me@my-server" };
// The tools that the machine has already. The components only check the names.
const tools: Tincto.Tools = { base: host, host, versions: { "npm:skills": "latest", "npm:t3": "nightly" } };
const tailnet = yield * Tincto.Tailnet("Tailscale", { host, join: false });

yield *
  Tincto.Agents("Home", {
    tools,
    skills: { agents: ["claude-code"], sources: { "vercel-labs/skills": ["find-skills"] } },
  });
const t3code = yield * Tincto.T3Code("T3Code", { tools, tailnet });
```

These components need no root: `Agents`, `Repos`, `BbMachine`, and `T3Code` when
the services of the user stay after logout already (`loginctl enable-linger`).
`Toolchain` with apt packages or services, `Tailnet` with a join, and `Serve` need root.

To share components between machines, export an Effect that yields them and returns
what the other components need, and yield it in each machine file.

A machine can change with the stage, as each Alchemy stack can. Deploy the
same file with `--stage test` to get a second copy of the machine with its own state:

```ts
const { stage } = yield * Alchemy.Stack;
const host = yield * Tincto.ExeHost("Vm", { cpu: stage.startsWith("live") ? 4 : 2 });
```

To let a different person use an exe.dev VM, give their public key to `ExeHost`. The
key opens this VM only, and the person needs no exe.dev account: they connect with
`ssh <name>.exe.xyz`. To stop the product usage data of T3 Code, give `telemetry: false`:

```ts
const host = yield * Tincto.ExeHost("Vm", { sshKeys: { rola: "ssh-ed25519 AAAA… rola@laptop" } });
const t3code = yield * Tincto.T3Code("T3Code", { tools, tailnet, telemetry: false });
```

## What you need

- For `Tailnet`: `TAILSCALE_API_KEY` in `.env`, a Tailscale API access token. tincto reads it with `effect/Config`.
  The stack uses it to make a one-use auth key and to remove the device on destroy.
- For `ExeHost`: run `ssh exe.dev` one time and complete the registration.
- For a machine that exists: SSH with your key, and sudo, apt and systemd on the machine.
  A machine with no apt, or where sudo asks for a password: see "A machine that a different tool manages".

## The components

| Component   | Needs              | Returns                   | What it does                                                                                    |
| ----------- | ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `ExeHost`   |                    | a host                    | An exe.dev VM with the name of the stack. `sshKeys` lets other persons connect to it.           |
| `Toolchain` | `host`             | `tools`                   | apt packages, system services, and command-line tools through [mise](https://mise.jdx.dev).     |
| `Tailnet`   | `host`             | `tailnet`                 | The machine as a device in your tailnet, with the name of the stack.                            |
| `Serve`     | `tailnet`, `rules` |                           | The HTTPS ports of the machine in the tailnet. One for each machine.                            |
| `Agents`    | `tools`            |                           | Instruction files of each agent, custom skills, skills from skill sources, plugins, home files. |
| `Repos`     | `host`             | the clones                | Copies your GitHub login to the machine, and clones each repository one time.                   |
| `T3Code`    | `tools`, `tailnet` | `url`, `pairUrl`, `serve` | The T3 Code server, with one project for each clone in `projects`. `telemetry: false` stops it. |
| `BbMachine` | `tools`            | `hostId`                  | The machine joins a bb server on a different computer as a bb machine.                          |
| `BbServer`  | `tools`, `tailnet` | `url`, `serve`            | A bb server on the machine, with its plugins.                                                   |

Each component takes an ID as its first argument, as each Alchemy resource does:
`Tincto.T3Code("T3Code", { … })`. The main resource of the component has that ID, and
its other resources are below it (`T3Code/Project-alpha`). So a stack can yield
a component two times with two IDs, for example two `Repos` with different directories.

A host is `{ sshDest }`. `tools.host` is the machine after all tools, and
`tools.base` is the machine after the apt packages only. A component runs after the
resources that made the host that you give it, so the props give the run order.

A component that needs a tool names it: `Agents` needs `npm:skills`, `T3Code` needs
`npm:t3`, and the bb components need `npm:bb-app`. A stack that yields the component with
no such tool stops the plan.

## Your own components

A component is an Effect that takes props and declares resources. For resources of
tincto or of a different Alchemy package, no more is necessary: write the Effect,
and merge the providers in the stack.

```ts
providers: Layer.mergeAll(Tincto.providers(), Cloudflare.providers(), Mine.providers()),
```

For a resource of your own that runs commands on the machine, tincto exports the
frame that its own resources use:

```ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Tincto from "tincto";

export class MyProviders extends Alchemy.ProviderCollection<MyProviders>()("Mine") {}

export interface HtopProps {
  sshDest: string;
}
export type Htop = Alchemy.Resource<"Mine.Htop", HtopProps, { installed: boolean }, never, MyProviders>;
export const Htop = Alchemy.Resource<Htop>("Mine.Htop");

export const HtopProvider = Tincto.provider(Htop, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* Tincto.runScript(news.sshDest, "sudo apt-get install -y -qq htop");
    return { installed: true };
  }),
  delete: ({ olds }) => Tincto.cleanUp(olds.sshDest, "sudo apt-get remove -y -qq htop"),
});

export const providers = () => Tincto.collect(MyProviders, [[Htop, HtopProvider]]);
```

- `runScript` runs a bash script on the machine through SSH. `cleanUp` does the same and ignores a failure.
- `userService` has the bash for a systemd service of the user. `authKey` makes a one-use Tailscale auth key.
- `tincto/testing` has a fake machine and a scripted shell, so a test runs the real script of your resource on your computer.

Test a resource with the test package of Alchemy, [`@alchemy.run/test`](https://alchemy.run/testing). It
runs the resource through the real engine: create, update, replace and destroy.

```ts
import { afterAll, beforeEach, expect } from "bun:test";
import * as Test from "@alchemy.run/test/Bun";
import * as Effect from "effect/Effect";
import { fakeMachine } from "tincto/testing";

// A temporary home directory, and a fake `ssh` that runs the script on this computer.
// `apt-get` and `sudo` are fakes that record their arguments.
const machine = fakeMachine(["apt-get"]);
beforeEach(machine.reset);
afterAll(machine.close);
const { test } = Test.make({ providers: providers() });

test.provider("Htop installs the package, and destroy removes it", (stack) =>
  Effect.gen(function* () {
    expect(yield* stack.deploy(Htop("Htop", { sshDest: "box" }))).toEqual({ installed: true });
    expect(machine.calls()).toEqual(["apt-get install -y -qq htop"]);
    yield* stack.destroy();
    expect(machine.calls().at(-1)).toBe("apt-get remove -y -qq htop");
  }),
);
```

## Community components

A component is easy to share: publish it to npm with `tincto` and `alchemy` as peer
dependencies, and open a pull request that adds it to this list. These are not
official, and the tincto team did not verify them.

| Component                                     | What it does |
| --------------------------------------------- | ------------ |
| _None yet. Open a pull request to add yours._ |              |

## For coding agents

- Install the skill: `npx skills add ahmedhesham6/tincto`.
- [`llms.txt`](https://raw.githubusercontent.com/ahmedhesham6/tincto/main/llms.txt) lists the documents as Markdown.

The source is at [github.com/ahmedhesham6/tincto](https://github.com/ahmedhesham6/tincto). To add a component
or to change tincto, read [CONTRIBUTING.md](https://github.com/ahmedhesham6/tincto/blob/main/CONTRIBUTING.md).
