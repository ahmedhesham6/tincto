import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeMachine } from "../src/testing.ts";

// A full deploy of the real stack and the example machine file, against a fake machine.
// It checks what the tests of one resource cannot: that the resources run in an order that works.
const machine = fakeMachine([
  "dpkg",
  "apt-get",
  "systemctl",
  "loginctl",
  "mise",
  "skills",
  "bb-app",
  "bb",
  "curl",
  "git",
  "claude",
  "codex",
  "pi",
]);
// The project of the tests: an example machine file, and the machine/ files that it names.
const root = join(import.meta.dirname, "project");
// Each machine of the tests is the example machine, with a name of its own.
const name = `test-${process.pid}`;
const machineFile = (machineName: string, stack: string) => {
  const file = join(root, "machines", `${machineName}.ts`);
  writeFileSync(
    file,
    `import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Tincto from "tincto";
import * as Effect from "effect/Effect";
import { example, host } from "./example.ts";
export default Alchemy.Stack("${machineName}", { providers: Tincto.providers(), state: Alchemy.localState() }, ${stack});
`,
  );
  return file;
};
const full = machineFile(name, "example");
// A machine with one kind of component, two times with two IDs.
const small = machineFile(
  `${name}-small`,
  `Effect.gen(function* () {
    yield* Tincto.Repos("Work", { host, githubLogin: false, dir: "work", sources: ["example/alpha"] });
    yield* Tincto.Repos("Play", { host, githubLogin: false, dir: "play", sources: ["example/alpha"] });
    // A resource of Alchemy itself, with only the providers of tincto.
    yield* Command.Exec("Local", { command: "true" });
  })`,
);
// A machine with a component, and without the tool that the component needs.
const noTool = machineFile(
  `${name}-no-tool`,
  `Effect.gen(function* () {
    // Each one with its defaults.
    const tools = yield* Tincto.Toolchain("Tools", { host, tools: { node: "24" } });
    const tailnet = yield* Tincto.Tailnet("Tailscale", { host: tools.base });
    yield* Tincto.T3Code("T3Code", { tools, tailnet });
  })`,
);
afterAll(() => {
  machine.close();
  for (const file of [full, small, noTool]) rmSync(file, { force: true });
  for (const machineName of [name, `${name}-small`, `${name}-no-tool`]) {
    rmSync(join(root, ".alchemy/staging", machineName), { recursive: true, force: true });
    rmSync(join(root, ".alchemy/state", machineName), { recursive: true, force: true });
  }
});

// A command with no value that changes from run to run or from computer to computer.
const plain = (text: string) =>
  text
    .replaceAll(machine.home, "~")
    .replaceAll(name, "<name>")
    .replace(/--key tincto-\w+/, "--key tincto-<id>")
    // The user of the computer that runs the test.
    .replace(/enable-linger \S+/, "enable-linger <user>");
// The Alchemy CLI itself asks the local Git for the project. Those calls are not on the machine.
const onMachine = () => machine.calls().filter((call) => !/^git (config|rev-)/.test(call));

const alchemy = async (command: string, file = full) => {
  const child = Bun.spawn(
    ["bunx", "alchemy", command, file, ...(command === "plan" ? [] : ["--yes"]), "--no-input", "--stage", "test"],
    {
      cwd: root,
      env: { ...process.env, TAILSCALE_API_KEY: "unused" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = (await new Response(child.stdout).text()) + (await new Response(child.stderr).text());
  return { code: await child.exited, output };
};

test("a deploy runs each resource after the resources that it needs, and a second deploy changes nothing", async () => {
  // The machine is in the tailnet already, so the Tailscale API is not necessary.
  machine.record(
    "tailscale",
    `if [ "$1" = status ]; then echo '{"BackendState":"Running","Self":{"ID":"n1","DNSName":"box.tail1.ts.net.","TailscaleIPs":["100.1.2.3"]}}'; fi`,
  );
  machine.record(
    "t3",
    `mkdir -p "$HOME/.config/systemd/user"; touch "$HOME/.config/systemd/user/t3code.service"
case "$*" in *"pairing create"*) echo '{"credential":"ABC123","pairUrl":"'"$9"'/pair#token=ABC123"}' ;; esac`,
  );
  // The Tailscale API, which destroy uses to remove the device, answers 200.
  machine.record("curl", 'case "$*" in *--config*) cat >/dev/null; printf "\\n200" ;; esac');
  // The bb server of this computer answers that the bb machine is active already.
  machine.record(
    "bb",
    `case "$*" in *"--json"*) echo '{"id":"host_1","name":"box","lifecycle":{"phase":"active"}}' ;; esac`,
  );
  // gh on this computer has a token, and gh on the machine accepts it.
  machine.record("gh", `case "$*" in "auth token") echo token-123 ;; "api user"*) echo octocat ;; esac`);
  // npm gives a version for each npm tag of the machine file, with no network.
  machine.bin("npm", 'echo "1.2.3"');

  const first = await alchemy("deploy");
  expect(first.output).not.toContain("ERROR");
  expect(first.code).toBe(0);
  // The deploy shows the link that pairs a T3 Code app with the server.
  expect(first.output).toContain("https://box.tail1.ts.net:9443/pair#token=ABC123");

  const calls = onMachine();
  // The pin: each command that the deploy runs on the machine, and each resource that it makes.
  // The order of independent resources can change from run to run, so the lists are sorted.
  expect(calls.map(plain).toSorted()).toMatchSnapshot("commands on the machine");
  expect([...first.output.matchAll(/\[(\S+)\] created/g)].map((match) => match[1]).toSorted()).toMatchSnapshot(
    "resources",
  );
  const at = (start: string) => {
    const index = calls.findIndex((call) => call.startsWith(start));
    if (index < 0) throw new Error(`no call starts with "${start}" in:\n${calls.join("\n")}`);
    return index;
  };
  // apt gives curl, which the Tailscale step and mise need.
  expect(at("dpkg -s")).toBeLessThan(at("tailscale status"));
  expect(at("dpkg -s")).toBeLessThan(at("mise install"));
  // The tools come before all that use them.
  for (const user of ["skills add", "claude plugin install", "pi install", "t3 service install", "bb machine create"]) {
    expect(at("mise reshim")).toBeLessThan(at(user));
  }
  // The custom skills are on the machine before the skills CLI writes the same directories.
  expect(machine.has(".claude/skills/hello/SKILL.md")).toBe(true);
  // The device is there before a Serve rule.
  expect(at("tailscale status")).toBeLessThan(at("tailscale serve --bg"));
  expect(calls).toContain("tailscale serve --bg --https=9443 http://100.1.2.3:3999");
  expect(calls).toContain("systemctl enable --now docker");
  expect(calls).toContain("codex plugin add tools@example-tools");
  // Each repository is a T3 Code project, added after the service and after its clone.
  const project = `t3 project add ${machine.home}/repos/alpha --title alpha`;
  expect(at("systemctl --user restart t3code")).toBeLessThan(at(project));
  expect(calls.findIndex((call) => call.endsWith(`${machine.home}/repos/alpha`))).toBeLessThan(at(project));
  // The GitHub login is on the machine before the clones.
  expect(at("gh auth login")).toBeLessThan(at("git -c http.https://github.com/.extraheader"));
  expect(machine.read(".config/mise/config.toml")).toContain('"npm:t3" = "1.2.3"');

  const second = await alchemy("deploy");
  expect(second.code).toBe(0);
  expect(onMachine().slice(calls.length)).toEqual([]);

  const destroyed = await alchemy("destroy");
  expect(destroyed.code).toBe(0);
  expect(machine.has(".claude/skills/hello")).toBe(false);
  expect(machine.calls()).toContain("systemctl --user disable --now t3code");
  expect(machine.calls()).toContain("bb machine remove host_1 --yes");
  expect(machine.calls()).toContain("curl --silent --show-error --max-time 30 --config -");
}, 180_000);

test("a machine has only the components that its stack yields, and a component can be there two times with two IDs", async () => {
  const before = onMachine().length;
  const deployed = await alchemy("deploy", small);
  expect(deployed.output).not.toContain("ERROR");
  expect(deployed.code).toBe(0);
  // Only the two clones, with the GitHub token of this computer: no tools, no tailnet, no agents.
  const calls = onMachine().slice(before);
  expect(calls.map((call) => call.split(" ")[0]).toSorted()).toEqual(["gh", "gh", "git", "git"]);
  for (const dir of ["work", "play"]) {
    expect(
      calls.filter((call) => call.endsWith(`clone https://github.com/example/alpha.git ${machine.home}/${dir}/alpha`)),
    ).toHaveLength(1);
  }
  expect(deployed.output).toContain("[Work/alpha] created");
  expect(deployed.output).toContain("[Play/alpha] created");
  expect(deployed.output).toContain("[Local] created");
}, 180_000);

test("a component without its tool stops the plan, before a command runs on the machine", async () => {
  const before = onMachine().length;
  const planned = await alchemy("plan", noTool);
  expect(planned.code).not.toBe(0);
  expect(planned.output).toContain('T3Code needs the tool "npm:t3". Add it to the tools of Toolchain.');
  expect(onMachine().slice(before)).toEqual([]);
}, 180_000);
