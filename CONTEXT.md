# Context

Terms that this repository uses. Use them in code, comments and documents.

## The environment

- **Dev environment**: the result of a deploy. A machine with each component of its machine file.
- **Machine**: the computer that the dev environment is on. One machine has one name.
- **Machine file**: `machines/<name>.ts` in the project of a person. The Alchemy stack of one machine. The name of the stack is the name of the machine.
- **Component**: a set of resources that a machine can have or not have: `ExeHost`, `Toolchain`, `Tailnet`, `Serve`, `Agents`, `Repos`, `T3Code`, `BbMachine`, `BbServer`. An Effect that a stack yields. Its first argument is its ID: the main resource of the component has that ID, and the other resources are below it (`Repos/tincto`). It takes what it needs as props and returns what other components can use.
- **Tools**: what `Toolchain` returns: the host after all tools, and the version of each tool.
- **Tailnet**: what the component `Tailnet` returns: the device, its tags, and the host after it is in the tailnet.
- **Library**: this repository, the npm package. It is built on Alchemy and has only components, their resources and `providers()`. A person writes a normal Alchemy stack. The machine files of a person are in a repository of their own.
- **Layer**: one separate part of the dev environment: host, network, toolchain, agents, repos, apps. One folder in `src/`. Its `index.ts` has the components of the layer.
- **Host**: what the host layer gives to the other layers. Only an SSH destination.
- **Run order**: which resource runs after which. A resource states it with `after(host, …)`.

## Parts of a layer

- **Resource**: an Alchemy resource. It has props, attributes and a provider.
- **Provider**: the handlers that make a resource agree with its props (`reconcile`) and remove it (`delete`).
- **Shell**: the Effect service that runs a command on the computer that runs the stack. All contact with exe.dev, the machine, the Tailscale API, npm and bb goes through it. Tests replace it.
- **Tool**: one entry of the `tools` of `Toolchain`. mise installs it.
- **Open version**: a version that is not exact, such as `24`, `latest` or an npm tag. A deploy moves it to the newest release.
- **User service**: a systemd service of the user on the machine. T3 Code and the bb server are user services.

## Agents

- **Agent**: a tool that reads instruction files and skills: `claude`, `codex`, `bb`.
- **Skill**: a directory with a `SKILL.md` that an agent reads.
- **Custom skill**: a skill that you wrote. It is in `machine/skills/` of your project.
- **Skill source**: a public repository of skills, for example `mattpocock/skills`. The `skills` CLI installs from it.
- **Skill store**: `~/.agents/skills` on the machine. Each custom skill is there one time. Agents get links.
- **Home**: the `Agent.Home` resource. The paths in the home directory that the stack owns.
- **Entry**: one path that Home owns, relative to the home directory.
- **Stage** (verb): to build, on the local disk, the home directory tree that the config describes.

## Repos

- **Repo**: a clone of a Git repository on the machine. The stack makes it one time and then never changes it.

## Network and apps

- **Device**: the machine as a member of the tailnet.
- **Serve rule**: one HTTPS port of the machine in the tailnet, and the local address that it sends requests to. With Funnel, the port is public.
- **bb server**: a bb app server on the machine.
- **bb machine**: the machine as an execution machine of a bb server on a different computer. Not the same as a bb server.
- **Enroll**: to connect a bb machine to its bb server with the enrollment command of bb.

## Tests

- **Provider test**: a test of one resource with `test.provider` of `@alchemy.run/test`. The resource runs through the Alchemy engine, with a state that only the test has.
- **Fake machine**: a temporary directory and a fake `ssh`, so that a test runs the real script of a resource on this computer.
- **Scripted shell**: a `Shell` that answers from a script, for commands that leave this computer. A test file gives it to `providers({ shell })`, and each test sets the replies with `script`.
