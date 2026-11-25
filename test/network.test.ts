import { beforeEach, expect } from "bun:test";
import * as Test from "@alchemy.run/test/Bun";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { TailscaleDevice } from "../src/network/TailscaleDevice.ts";
import { providers } from "../src/Providers.ts";
import { scriptedShell } from "../src/testing.ts";

const running = JSON.stringify({
  BackendState: "Running",
  Self: { ID: "nABC", DNSName: "box.tail1.ts.net.", TailscaleIPs: ["100.1.2.3", "fd7a::1"] },
});
const loggedOut = JSON.stringify({ BackendState: "NeedsLogin" });
const device = { nodeId: "nABC", dnsName: "box.tail1.ts.net", ipv4: "100.1.2.3" };
// The stack joined the device or changed it, so the device is the stack's.
const attributes = { ...device, joined: true };
const news = { sshDest: "box.exe.xyz", hostname: "box", tags: ["tag:dev"], ssh: true };

const shell = scriptedShell();
const { test } = Test.make({ providers: providers({ shell: shell.layer }) });

beforeEach(() => {
  process.env.TAILSCALE_API_KEY = "tskey-api-test";
});

test.provider("TailscaleDevice makes a one-use auth key and joins a machine that is not in the tailnet", (stack) =>
  Effect.gen(function* () {
    shell.script((line, calls) => {
      if (line.startsWith("curl ")) return `${JSON.stringify({ id: "k1", key: "tskey-auth-once" })}\n200`;
      return calls.some((call) => call.stdin?.includes("tailscale up")) ? running : loggedOut;
    });
    expect(yield* stack.deploy(TailscaleDevice("Device", news))).toEqual(attributes);

    const [, request, up] = shell.calls;
    expect(request?.line).not.toContain("tskey");
    expect(request?.stdin).toContain("Authorization: Bearer tskey-api-test");
    expect(request?.stdin).toContain("/api/v2/tailnet/-/keys");
    const body = JSON.parse(JSON.parse(request!.stdin!.match(/^data = (.*)$/m)![1]!));
    expect(body.expirySeconds).toBe(600);
    expect(body.capabilities.devices.create).toEqual({
      reusable: false,
      ephemeral: false,
      preauthorized: true,
      tags: ["tag:dev"],
    });
    expect(up?.line).not.toContain("tskey");
    expect(up?.stdin).toContain("export AUTH_KEY='tskey-auth-once'");
    expect(up?.stdin).toContain("export TAGS='tag:dev'");
  }),
);

test.provider("TailscaleDevice makes no auth key when the machine is in the tailnet already", (stack) =>
  Effect.gen(function* () {
    shell.script(() => running);
    expect(yield* stack.deploy(TailscaleDevice("Device", news))).toEqual(attributes);
    expect(shell.calls.some((call) => call.line.startsWith("curl "))).toBe(false);
    expect(shell.calls[1]?.stdin).toContain("tailscale set");
  }),
);

test.provider("TailscaleDevice reports the reply of the Tailscale API when it refuses to make a key", (stack) =>
  Effect.gen(function* () {
    shell.script((line) => (line.startsWith("curl ") ? '{"message":"tags required"}\n400' : loggedOut));
    const error = yield* Effect.flip(stack.deploy(TailscaleDevice("Device", news)));
    expect(String(error)).toContain("HTTP 400");
  }),
);

test.provider("TailscaleDevice says which variable to set when there is no API key", (stack) =>
  Effect.gen(function* () {
    shell.script(() => loggedOut);
    // A config with no values, in place of the environment of this test run.
    const noKey = ConfigProvider.layer(ConfigProvider.fromEnvRecord({}));
    const error = yield* Effect.flip(stack.deploy(TailscaleDevice("Device", news)).pipe(Effect.provide(noKey)));
    expect(String(error)).toContain("TAILSCALE_API_KEY");
    expect(shell.calls.some((call) => call.line.startsWith("curl "))).toBe(false);
  }),
);

test.provider("TailscaleDevice fails when the machine does not connect after the join", (stack) =>
  Effect.gen(function* () {
    shell.script((line) => (line.startsWith("curl ") ? '{"key":"k"}\n200' : loggedOut));
    const error = yield* Effect.flip(stack.deploy(TailscaleDevice("Device", news)));
    expect(String(error)).toContain("did not connect");
  }),
);

test.provider(
  "TailscaleDevice destroy removes the device, accepts a device that is gone, and reports other replies",
  (stack) =>
    Effect.gen(function* () {
      const destroyWith = (reply: string) =>
        Effect.gen(function* () {
          shell.script(() => running);
          yield* stack.deploy(TailscaleDevice("Device", news));
          shell.script(() => reply);
          yield* stack.destroy();
        });

      yield* destroyWith("\n200");
      expect(shell.calls).toHaveLength(1);
      expect(shell.calls[0]?.stdin).toContain('request = "DELETE"');
      expect(shell.calls[0]?.stdin).toContain("/api/v2/device/nABC");

      yield* destroyWith("\n404");
      expect(String(yield* Effect.flip(destroyWith("denied\n403")))).toContain("HTTP 403");
    }),
);

test.provider(
  "TailscaleDevice with join off reads a device that is in the tailnet, and does not change or remove it",
  (stack) =>
    Effect.gen(function* () {
      shell.script(() => running);
      expect(yield* stack.deploy(TailscaleDevice("Device", { ...news, join: false }))).toEqual({
        ...device,
        joined: false,
      });
      // One read, with no root: no install, no service start, no `tailscale set`, no API call.
      expect(shell.calls).toHaveLength(1);
      expect(shell.calls[0]?.stdin).toContain("tailscale status --json");
      expect(shell.calls[0]?.stdin).not.toContain("sudo");

      shell.script(() => running);
      yield* stack.destroy();
      expect(shell.calls).toEqual([]);
    }),
);

test.provider("TailscaleDevice with join off fails when the machine is not in the tailnet", (stack) =>
  Effect.gen(function* () {
    shell.script(() => loggedOut);
    const error = yield* Effect.flip(stack.deploy(TailscaleDevice("Device", { ...news, join: false })));
    expect(String(error)).toContain("is not in the tailnet");
    expect(shell.calls.some((call) => call.line.startsWith("curl "))).toBe(false);
  }),
);

test.provider("TailscaleDevice destroy goes by what the stack did, not by a change of join that failed", (stack) =>
  Effect.gen(function* () {
    // A person joined the device. A change to a join fails, so the stack never had the device.
    shell.script(() => running);
    yield* stack.deploy(TailscaleDevice("Device", { ...news, join: false }));
    shell.script(() => ({ code: 1, stderr: "sudo: a password is required" }));
    yield* Effect.flip(stack.deploy(TailscaleDevice("Device", news)));
    shell.script(() => "\n200");
    yield* stack.destroy();
    expect(shell.calls.some((call) => call.line.startsWith("curl "))).toBe(false);

    // The stack joined the device. A change to join off fails, so the device is still the stack's.
    shell.script(() => running);
    yield* stack.deploy(TailscaleDevice("Device", news));
    shell.script(() => loggedOut);
    yield* Effect.flip(stack.deploy(TailscaleDevice("Device", { ...news, join: false })));
    shell.script(() => "\n200");
    yield* stack.destroy();
    expect(shell.calls[0]?.stdin).toContain("/api/v2/device/nABC");
  }),
);
