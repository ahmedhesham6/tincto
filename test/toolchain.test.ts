import { afterAll, beforeEach, expect, test as plainTest } from "bun:test";
import * as Test from "@alchemy.run/test/Bun";
import * as Effect from "effect/Effect";
import { providers } from "../src/Providers.ts";
import { fakeMachine, run, scriptedShell } from "../src/testing.ts";
import { AptPackages } from "../src/toolchain/AptPackages.ts";
import { Mise, miseConfig } from "../src/toolchain/Mise.ts";
import { SystemService } from "../src/toolchain/SystemService.ts";
import { resolveTools, today } from "../src/toolchain/versions.ts";

const machine = fakeMachine(["mise", "systemctl", "apt-get"]);
beforeEach(machine.reset);
afterAll(machine.close);

const { test } = Test.make({ providers: providers() });

test.provider("Mise writes the tool list as the mise config, then installs, upgrades and prunes", (stack) =>
  Effect.gen(function* () {
    const tools = { node: "24", "npm:t3": "0.1.12-nightly.1" };
    expect(yield* stack.deploy(Mise("Mise", { sshDest: "box", tools, refresh: "2026-11-23" }))).toEqual({ tools });
    expect(machine.read(".config/mise/config.toml")).toBe(miseConfig(tools));
    expect(miseConfig(tools)).toContain('"node" = "24"\n"npm:t3" = "0.1.12-nightly.1"\n');
    expect(machine.calls()).toEqual(["mise install", "mise upgrade", "mise prune", "mise reshim"]);
  }),
);

test.provider("Mise adds the bash line one time only", (stack) =>
  Effect.gen(function* () {
    yield* stack.deploy(Mise("Mise", { sshDest: "box", tools: {} }));
    yield* stack.deploy(Mise("Mise", { sshDest: "box", tools: {} }), { force: true });
    expect(machine.calls().filter((call) => call === "mise install")).toHaveLength(2);
    expect(machine.read(".bashrc").match(/mise activate bash/g)).toHaveLength(1);
  }),
);

test.provider("AptPackages installs only when a package is missing", (stack) =>
  Effect.gen(function* () {
    const news = { sshDest: "box", packages: ["git", "jq"] };
    machine.record("dpkg", "exit 1");
    expect(yield* stack.deploy(AptPackages("Apt", news))).toEqual({ packages: ["git", "jq"] });
    expect(machine.calls()).toEqual(["dpkg -s git jq", "apt-get update -qq", "apt-get install -y -qq git jq"]);

    machine.reset();
    machine.record("dpkg");
    yield* stack.deploy(AptPackages("Apt", news), { force: true });
    expect(machine.calls()).toEqual(["dpkg -s git jq"]);
  }),
);

test.provider("SystemService enables the unit, and destroy disables it", (stack) =>
  Effect.gen(function* () {
    expect(yield* stack.deploy(SystemService("Service", { sshDest: "box", name: "docker" }))).toEqual({
      name: "docker",
    });
    yield* stack.destroy();
    expect(machine.calls()).toEqual(["systemctl enable --now docker", "systemctl disable --now docker"]);
  }),
);

plainTest("resolveTools changes an npm tag to the version that npm has, and keeps the other versions", async () => {
  const npm = scriptedShell((line) => (line === "npm view t3@nightly version" ? "0.1.12-nightly.5\n" : undefined));
  const tools = { node: "24", bun: "1.4.5", "npm:t3": "nightly", "npm:bb-app": "0.50.1" };
  expect(await run(resolveTools(tools), npm.layer)).toEqual({
    tools: { node: "24", bun: "1.4.5", "npm:t3": "0.1.12-nightly.5", "npm:bb-app": "0.50.1" },
    refresh: today(),
  });
  expect(npm.lines()).toEqual(["npm view t3@nightly version"]);
});

plainTest("resolveTools gives no refresh when each version is exact", async () => {
  const npm = scriptedShell(() => undefined);
  expect((await run(resolveTools({ bun: "1.4.5", "npm:t3": "0.1.12" }), npm.layer)).refresh).toBeUndefined();
  expect(npm.lines()).toEqual([]);
});

plainTest("resolveTools fails when npm has no version for the tag", async () => {
  const npm = scriptedShell(() => "");
  await expect(run(resolveTools({ "npm:t3": "no-such-tag" }), npm.layer)).rejects.toThrow("npm has no version");
});

test.provider("Mise writes the release age setting only when the config gives one", (stack) =>
  Effect.gen(function* () {
    yield* stack.deploy(Mise("Mise", { sshDest: "box", tools: { claude: "latest" }, minimumReleaseAge: "0s" }));
    expect(machine.read(".config/mise/config.toml")).toContain('[settings]\nminimum_release_age = "0s"\n');
    expect(miseConfig({ claude: "latest" })).not.toContain("minimum_release_age");
  }),
);
