import { afterAll, beforeEach, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { Shell } from "../src/remote/Shell.ts";
import { cleanUp, runScript } from "../src/remote/Ssh.ts";
import { fakeMachine, run } from "../src/testing.ts";

const machine = fakeMachine();
beforeEach(machine.reset);
afterAll(machine.close);

test("runScript gives the script its environment with shell characters unchanged", async () => {
  const value = `it's "$HOME" \`id\` $(id)`;
  const result = await run(runScript("box", 'printf "%s" "$VALUE"', { VALUE: value }));
  expect(result.stdout).toBe(value);
});

test("runScript fails when a command in the script fails", async () => {
  await expect(run(runScript("box", "echo before; false; echo after"))).rejects.toThrow(/exit code 1/);
});

test("runScript runs each line, also after a command that reads standard input", async () => {
  const result = await run(runScript("box", "cat >/dev/null\necho after"));
  expect(result.stdout).toBe("after\n");
});

test("runScript puts the tools of the machine first on PATH", async () => {
  const result = await run(runScript("box", 'printf "%s" "$PATH"'));
  expect(result.stdout.startsWith(`${machine.home}/.local/share/mise/shims:${machine.home}/.local/bin:`)).toBe(true);
});

test("cleanUp does not fail when the machine does not answer", async () => {
  machine.bin("ssh", "exit 255");
  await run(cleanUp("box", "true"));
});

test("the shell stops a command after the given time and gives what it printed", async () => {
  const result = await run(
    Effect.gen(function* () {
      const shell = yield* Shell;
      return yield* shell.run("bash", ["-c", "echo started >&2; sleep 30"], { interruptAfterMs: 300 });
    }),
  );
  expect(result.stderr).toBe("started\n");
  expect(result.code).not.toBe(0);
});
