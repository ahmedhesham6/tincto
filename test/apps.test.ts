import { afterAll, beforeEach, expect, test as plainTest } from "bun:test";
import * as Test from "@alchemy.run/test/Bun";
import * as Effect from "effect/Effect";
import { BbMachine } from "../src/apps/BbMachine.ts";
import { BbPlugin } from "../src/apps/BbPlugin.ts";
import { BbServer } from "../src/apps/BbServer.ts";
import { pluginName } from "../src/apps/index.ts";
import { T3Code } from "../src/apps/T3Code.ts";
import { T3Project } from "../src/apps/T3Project.ts";
import { TailscaleServe } from "../src/apps/TailscaleServe.ts";
import { providers } from "../src/Providers.ts";
import { fakeMachine, scriptedShell } from "../src/testing.ts";

const machine = fakeMachine(["systemctl", "loginctl", "tailscale", "bb-app", "bb", "curl"]);
beforeEach(() => {
  machine.reset();
  // `t3 service install` writes its own unit on a real machine.
  machine.record(
    "t3",
    `mkdir -p "$HOME/.config/systemd/user"; touch "$HOME/.config/systemd/user/t3code.service"
case "$*" in *"pairing create"*) echo '{"credential":"ABC123","pairUrl":"'"$9"'/pair#token=ABC123"}' ;; esac`,
  );
});
afterAll(machine.close);

const { test } = Test.make({ providers: providers() });
const start = (name: string, lingers = false) => [
  `loginctl show-user ${process.env.USER} --property=Linger --value`,
  ...(lingers ? [] : [`loginctl enable-linger ${process.env.USER}`]),
  "systemctl --user daemon-reload",
  `systemctl --user enable ${name}`,
  `systemctl --user restart ${name}`,
];
const stop = (name: string) => [`systemctl --user disable --now ${name}`, "systemctl --user daemon-reload"];
const unitPath = `Environment=PATH=${machine.home}/.local/share/mise/shims:${machine.home}/.local/bin:/usr/local/sbin:`;

test.provider("T3Code installs the service, binds it to the given address, and starts it", (stack) =>
  Effect.gen(function* () {
    const publicUrl = "https://box.tail1.ts.net:9443";
    const news = { sshDest: "box", version: "2.0.0", host: "100.1.2.3", port: 3999, publicUrl };
    expect(yield* stack.deploy(T3Code("T3", news))).toEqual({
      url: "http://100.1.2.3:3999",
      pairUrl: `${publicUrl}/pair#token=ABC123`,
    });
    const override = machine.read(".config/systemd/user/t3code.service.d/override.conf");
    expect(override).toContain("Environment=T3CODE_HOST=100.1.2.3\nEnvironment=T3CODE_PORT=3999\n");
    expect(override).toContain(unitPath);
    expect(machine.calls()).toEqual([
      "t3 service install",
      ...start("t3code"),
      `t3 auth pairing create --ttl 1h --label tincto --base-url ${publicUrl} --json`,
    ]);

    yield* stack.destroy();
    expect(machine.calls().slice(-2)).toEqual(stop("t3code"));
    expect(machine.has(".config/systemd/user/t3code.service")).toBe(false);
    expect(machine.has(".config/systemd/user/t3code.service.d")).toBe(false);
  }),
);

test.provider("T3Code turns telemetry off only when the machine file says so", (stack) =>
  Effect.gen(function* () {
    const news = { sshDest: "box", version: "2.0.0", host: "100.1.2.3", port: 3999, publicUrl: "https://box:9443" };
    const override = () => machine.read(".config/systemd/user/t3code.service.d/override.conf");
    yield* stack.deploy(T3Code("T3", news));
    expect(override()).not.toContain("T3CODE_TELEMETRY_ENABLED");

    // The change starts the service again, so the server reads the new value.
    yield* stack.deploy(T3Code("T3", { ...news, telemetry: false }));
    expect(override()).toContain("Environment=T3CODE_PORT=3999\nEnvironment=T3CODE_TELEMETRY_ENABLED=false\n");
    expect(machine.calls().filter((call) => call === "systemctl --user restart t3code")).toHaveLength(2);
  }),
);

test.provider("T3Code needs no root on a machine where the services of the user stay already", (stack) =>
  Effect.gen(function* () {
    machine.record("loginctl", 'if [ "$1" = show-user ]; then echo yes; fi');
    // sudo asks for a password on this machine, so a script cannot use it.
    machine.bin("sudo", "echo 'sudo: a password is required' >&2; exit 1");
    const news = { sshDest: "box", version: "2.0.0", host: "100.1.2.3", port: 3999, publicUrl: "https://box:9443" };
    yield* stack.deploy(T3Code("T3", news));
    expect(machine.calls().slice(1, 5)).toEqual(start("t3code", true));
    // The directories of NixOS are on the PATH of the unit.
    expect(machine.read(".config/systemd/user/t3code.service.d/override.conf")).toContain(
      ":/etc/profiles/per-user/%u/bin:/run/wrappers/bin:/run/current-system/sw/bin\n",
    );
  }),
);

test.provider(
  "BbServer writes the unit with updates off, sets the address, starts the service and waits for it",
  (stack) =>
    Effect.gen(function* () {
      const news = { sshDest: "box", version: "0.50.1", port: 38886, url: "https://box.tail1.ts.net:8443" };
      expect(yield* stack.deploy(BbServer("Server", news))).toEqual({
        localUrl: "http://127.0.0.1:38886",
        url: news.url,
      });
      const unit = machine.read(".config/systemd/user/bb-app.service");
      expect(unit).toContain(
        `ExecStart=${machine.home}/.local/share/mise/shims/bb-app --no-in-app-updates --server-port 38886`,
      );
      expect(unit).toContain(unitPath);
      expect(machine.calls()).toEqual([
        "bb-app config set BB_APP_URL https://box.tail1.ts.net:8443",
        ...start("bb-app"),
        "curl -fsS -o /dev/null http://127.0.0.1:38886/",
      ]);

      yield* stack.destroy();
      expect(machine.calls().slice(-2)).toEqual(stop("bb-app"));
      expect(machine.has(".config/systemd/user/bb-app.service")).toBe(false);
    }),
);

test.provider("BbServer fails with a clear message when the server does not answer", (stack) =>
  Effect.gen(function* () {
    machine.bin("curl", "exit 7");
    machine.bin("sleep", "exit 0");
    const news = { sshDest: "box", version: "0.50.1", port: 38886, url: "https://box" };
    const error = yield* Effect.flip(stack.deploy(BbServer("Server", news)));
    expect(String(error)).toContain("did not answer on port 38886");
  }),
);

test.provider("BbPlugin installs the source, and accepts a failed install only when the list has the source", (stack) =>
  Effect.gen(function* () {
    const news = { sshDest: "box", source: "git:https://example.com/p.git@semver:^0" };
    expect(yield* stack.deploy(BbPlugin("Plugin", news))).toEqual({ source: news.source });
    expect(machine.calls()).toEqual([`bb plugin install ${news.source} --yes`]);

    machine.bin("bb", `[ "$2" = list ] && echo "  source: ${news.source}" && exit 0; exit 1`);
    expect(yield* stack.deploy(BbPlugin("Plugin", news), { force: true })).toEqual({ source: news.source });

    machine.bin("bb", `[ "$2" = list ] && echo "  source: other" && exit 0; exit 1`);
    yield* Effect.flip(stack.deploy(BbPlugin("Plugin", news), { force: true }));
  }),
);

plainTest("pluginName gives the repository or package name with no version", () => {
  expect(pluginName("git:https://github.com/me/bb-plugin-treelanes.git@semver:^0")).toBe("bb-plugin-treelanes");
  expect(pluginName("npm:@scope/bb-plugin-x@1.2.3")).toBe("bb-plugin-x");
  expect(pluginName("rephrase")).toBe("rephrase");
});

test.provider(
  "TailscaleServe turns each owned port off, then sets the rules, with Funnel only where the rule says so",
  (stack) =>
    Effect.gen(function* () {
      // The stack owns the ports 8443 and 10443 before the deploy of the test.
      const before = [
        { port: 8443, target: "http://127.0.0.1:1" },
        { port: 10443, target: "http://127.0.0.1:2" },
      ];
      yield* stack.deploy(TailscaleServe("Serve", { sshDest: "box", rules: before }));
      const done = machine.calls().length;

      const rules = [
        { port: 8443, target: "http://127.0.0.1:38886", funnel: true },
        { port: 9443, target: "http://100.1.2.3:3999" },
      ];
      expect(yield* stack.deploy(TailscaleServe("Serve", { sshDest: "box", rules }))).toEqual({ ports: [8443, 9443] });
      expect(machine.calls().slice(done)).toEqual([
        "tailscale serve --https=8443 off",
        "tailscale serve --https=10443 off",
        "tailscale serve --https=9443 off",
        "tailscale funnel --bg --https=8443 http://127.0.0.1:38886",
        "tailscale serve --bg --https=9443 http://100.1.2.3:3999",
      ]);

      yield* stack.destroy();
      expect(machine.calls().slice(-2)).toEqual([
        "tailscale serve --https=8443 off",
        "tailscale serve --https=9443 off",
      ]);
    }),
);

test.provider("TailscaleServe with no rules runs no command, and turns off the ports that it had", (stack) =>
  Effect.gen(function* () {
    expect(yield* stack.deploy(TailscaleServe("Serve", { sshDest: "box", rules: [] }))).toEqual({ ports: [] });
    expect(machine.calls()).toEqual([]);

    const rules = [{ port: 9443, target: "http://100.1.2.3:3999" }];
    yield* stack.deploy(TailscaleServe("Serve", { sshDest: "box", rules }));
    const done = machine.calls().length;
    expect(yield* stack.deploy(TailscaleServe("Serve", { sshDest: "box", rules: [] }))).toEqual({ ports: [] });
    expect(machine.calls().slice(done)).toEqual(["tailscale serve --https=9443 off"]);
  }),
);

// Bb.Machine talks to the bb CLI of this computer, so its tests script the replies.
const shell = scriptedShell();
const scripted = Test.make({ providers: providers({ shell: shell.layer }) });
const record = (phase: string, name = "Manual machine setup x", id = "host_1") =>
  JSON.stringify({ id, name, lifecycle: { phase, message: "Run the enrollment command shown below" } });
const enroll = "curl -fsSL -H 'X-BB-Enrollment: secret' 'https://bb.example/install.sh' | sh";
const props = { name: "box", sshDest: "box.exe.xyz" };
// The engine makes the instance ID, so the key of the bb machine is different in each test.
const key = /tincto-[0-9A-Za-z_-]+/;
const lines = () => shell.lines().map((line) => line.replace(key, "tincto-KEY"));
const follow = (line: string) => line.includes("machine create") && !line.includes("--no-wait");

scripted.test.provider(
  "BbMachine makes the bb machine, runs the enrollment command on the machine, and names it",
  (stack) =>
    Effect.gen(function* () {
      shell.script((line, calls) => {
        if (line.includes("--no-wait")) return record("creating");
        if (follow(line)) return { code: 130, stderr: `${enroll}\nThis command expires soon\n` };
        if (line.includes("machine show")) {
          return record(calls.some((call) => call.stdin?.includes(enroll)) ? "active" : "creating");
        }
      });
      expect(yield* stack.deploy(BbMachine("Machine", props))).toEqual({ hostId: "host_1", name: "box" });
      expect(lines()).toEqual([
        "bb machine create --provider manual --key tincto-KEY --no-wait --json",
        "bb machine create --provider manual --key tincto-KEY",
        "ssh box.exe.xyz bash -s",
        "bb machine show host_1 --json",
        "bb machine rename host_1 box",
      ]);
      // The two create commands use the same key, so bb gives the same machine.
      expect(shell.lines()[1]?.match(key)?.[0]).toBe(shell.lines()[0]?.match(key)?.[0]);
      // The follow of bb stops after 20 seconds, with no `timeout` command: macOS does not have one.
      expect(shell.calls[1]?.interruptAfterMs).toBe(20_000);
      // The credential goes to the machine through stdin, not through an argument.
      expect(shell.calls[2]?.stdin).toContain(enroll);
    }),
);

scripted.test.provider("BbMachine changes nothing when the bb machine is active and has the right name", (stack) =>
  Effect.gen(function* () {
    shell.script(() => record("active", "box"));
    const output = yield* stack.deploy(BbMachine("Machine", props));

    shell.script(() => record("active", "box"));
    expect(yield* stack.deploy(BbMachine("Machine", props), { force: true })).toEqual(output);
    expect(shell.lines()).toEqual(["bb machine show host_1 --json"]);
  }),
);

scripted.test.provider("BbMachine makes the bb machine again when bb no longer has it", (stack) =>
  Effect.gen(function* () {
    shell.script(() => record("active", "box", "host_old"));
    expect(yield* stack.deploy(BbMachine("Machine", props))).toEqual({ hostId: "host_old", name: "box" });

    shell.script((line) => {
      if (line.includes("machine show host_old")) return { code: 1, stderr: "Host not found" };
      if (line.includes("--no-wait")) return record("active", "box");
    });
    expect(yield* stack.deploy(BbMachine("Machine", props), { force: true })).toEqual({
      hostId: "host_1",
      name: "box",
    });
  }),
);

scripted.test.provider("BbMachine fails with the bb message when bb prints no enrollment command", (stack) =>
  Effect.gen(function* () {
    shell.script((line) => {
      if (line.includes("--no-wait")) return record("creating");
      if (follow(line)) return { code: 1, stderr: "Could not reach the bb server" };
    });
    const error = yield* Effect.flip(stack.deploy(BbMachine("Machine", props)));
    expect(String(error)).toContain("Could not reach the bb server");
  }),
);

scripted.test.provider("BbMachine delete removes the bb machine, and does nothing when bb no longer has it", (stack) =>
  Effect.gen(function* () {
    shell.script(() => record("active", "box"));
    yield* stack.deploy(BbMachine("Machine", props));
    shell.script((line) => (line.includes("machine show") ? record("active") : ""));
    yield* stack.destroy();
    expect(shell.lines()).toEqual(["bb machine show host_1 --json", "bb machine remove host_1 --yes"]);

    shell.script(() => record("active", "box"));
    yield* stack.deploy(BbMachine("Machine", props));
    shell.script(() => ({ code: 1 }));
    yield* stack.destroy();
    expect(shell.lines()).toEqual(["bb machine show host_1 --json"]);
  }),
);

test.provider("T3Code fails with a clear message when t3 prints no pairing link", (stack) =>
  Effect.gen(function* () {
    machine.record("t3", "echo 'no server'");
    const news = { sshDest: "box", version: "2.0.0", host: "100.1.2.3", port: 3999, publicUrl: "https://box" };
    const error = yield* Effect.flip(stack.deploy(T3Code("T3", news)));
    expect(String(error)).toContain("did not print a pairing link");
  }),
);

scripted.test.provider(
  "BbMachine uses the bb CLI of the server computer through SSH when the config names it",
  (stack) =>
    Effect.gen(function* () {
      shell.script(() => record("active", "box"));
      yield* stack.deploy(BbMachine("Machine", { ...props, serverSsh: "me@bb-server" }));
      expect(lines()).toEqual([
        "ssh me@bb-server 'bb' 'machine' 'create' '--provider' 'manual' '--key' 'tincto-KEY' '--no-wait' '--json'",
      ]);
    }),
);

scripted.test.provider("BbMachine reports the message of bb when a bb command fails", (stack) =>
  Effect.gen(function* () {
    shell.script(() => ({ code: 1, stderr: "No running bb server found" }));
    const local = yield* Effect.flip(stack.deploy(BbMachine("Machine", props)));
    expect(String(local)).toMatch(/No running bb server found.*give `serverSsh`/);
    const remote = { ...props, serverSsh: "me@bb-server" };
    const far = yield* Effect.flip(stack.deploy(BbMachine("Machine", remote)));
    expect(String(far)).toMatch(/failed on me@bb-server.*ssh me@bb-server bb --version/);
  }),
);

const projectNews = { sshDest: "box", path: "repos/tincto", title: "tincto" };

test.provider("T3Project adds the directory as a project with its title", (stack) =>
  Effect.gen(function* () {
    machine.record("t3");
    expect(yield* stack.deploy(T3Project("Project", projectNews))).toEqual({ path: "repos/tincto" });
    expect(machine.calls()).toEqual([`t3 project add ${machine.home}/repos/tincto --title tincto`]);
  }),
);

test.provider("T3Project accepts a project that T3 Code has already, and reports each other failure", (stack) =>
  Effect.gen(function* () {
    machine.bin("t3", `echo "ERROR (#2): ProjectAlreadyExistsError: An active project already exists" >&2; exit 1`);
    expect(yield* stack.deploy(T3Project("Project", projectNews))).toEqual({ path: "repos/tincto" });

    machine.bin("t3", `echo "ERROR (#2): WorkspaceRootNotExistsError: Workspace root does not exist" >&2; exit 1`);
    const error = yield* Effect.flip(stack.deploy(T3Project("Project", projectNews), { force: true }));
    expect(String(error)).toContain("Workspace root does not exist");
  }),
);
