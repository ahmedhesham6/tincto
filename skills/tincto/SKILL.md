---
name: tincto
description: Describe a dev machine as code with tincto, the components for Alchemy stacks - add or change a machine file, write a component, plan and deploy. Use when the user wants to set up, change or maintain a server or dev machine with tincto, or when a file imports from "tincto".
---

# tincto

tincto is components for [Alchemy](https://alchemy.run). A machine is a normal Alchemy stack that yields the components that the machine must have.

## Rules

- A deploy and a destroy change a real machine. Run `plan` first and show the result. Run `deploy` or `destroy` only when the user asks for it.
- Secrets go in `.env`, never in a machine file. `TAILSCALE_API_KEY` is necessary for the `Tailnet` component.
- Run the commands in the root of the project: `Agents` reads `machine/` there, and Alchemy keeps `.alchemy/` there.
- The name of the stack is the name of the machine: its host name in the tailnet, and the name of an exe.dev VM.

## Commands

```sh
bunx alchemy plan machines/<name>.ts      # show what a deploy will change
bunx alchemy deploy machines/<name>.ts    # make or update the machine
bunx alchemy destroy machines/<name>.ts   # remove the machine
```

## A machine

```ts
// machines/my-box.ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Tincto from "tincto";

export default Alchemy.Stack(
  "my-box",
  { providers: Tincto.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const host = yield* Tincto.ExeHost("Vm", { cpu: 2, memory: "8GB", disk: "50GB" }); // or { sshDest: "user@host" }
    const tools = yield* Tincto.Toolchain("Tools", {
      host,
      tools: { node: "24", gh: "latest", "npm:t3": "nightly" },
    });
    const tailnet = yield* Tincto.Tailnet("Tailscale", { host: tools.base });
    const clones = yield* Tincto.Repos("Repos", { host: tools.host, sources: ["owner/name"] });
    const t3code = yield* Tincto.T3Code("T3Code", { tools, tailnet, projects: clones });
    yield* Tincto.Serve("Serve", { tailnet, rules: [t3code.serve] });
    return { ssh: host.sshDest, t3code: t3code.url, t3codePair: t3code.pairUrl };
  }),
);
```

- The components: `ExeHost`, `Toolchain`, `Tailnet`, `Serve`, `Agents`, `Repos`, `T3Code`, `BbMachine`, `BbServer`.
- Each component takes an ID first, then props. The props say what it needs: `host`, `tools` (from `Toolchain`) or `tailnet` (from `Tailnet`). The type checker names what is missing.
- Each other value has a default. A machine has only the components that its stack yields.
- A component that needs a tool names it: `Agents` needs `npm:skills`, `T3Code` needs `npm:t3`, the bb components need `npm:bb-app`. Put the tool in `tools` of `Toolchain`.
- One machine has one `Serve`. Give it the `serve` rule of each component that returns one.

## Your own component

A component is an Effect that takes an ID and props and declares resources. For a resource of your own that runs commands on the machine, use `provider`, `runScript`, `cleanUp` and `collect` from tincto, and merge your providers in the stack: `Layer.mergeAll(Tincto.providers(), Mine.providers())`. The README has a full example: `node_modules/tincto/README.md`.

## Tests

Test a resource with `test.provider` of `@alchemy.run/test` and the fake machine of `tincto/testing`. The README has an example.
