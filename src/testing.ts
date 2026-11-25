import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Provider } from "alchemy";
import type { ResourceLike } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Shell, ShellLive, type ShellResult } from "./remote/Shell.ts";

/** The input of a lifecycle handler, with only the parts that a test must give. */
interface Input<R extends ResourceLike> {
  news?: R["Props"];
  olds?: R["Props"];
  output?: R["Attributes"];
  instanceId?: string;
}

/**
 * Calls one lifecycle handler of a resource with no engine. Test a resource with
 * `test.provider` of `@alchemy.run/test`. This is only for a handler that the engine
 * does not call in a test, such as `read` in a drift check.
 */
export const lifecycle = <R extends ResourceLike>(
  resource: { Type: string },
  provider: Layer.Layer<Provider<R>, never, Shell>,
  shell: Layer.Layer<Shell> = ShellLive,
) => {
  const call =
    <A>(handler: string) =>
    (input: Input<R>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const handlers = (yield* Provider(resource.Type as never)) as unknown as Record<
            string,
            (input: Input<R>) => Effect.Effect<A, unknown>
          >;
          return yield* handlers[handler]!(input);
        }).pipe(
          Effect.provide(provider.pipe(Layer.provide(shell))),
          // Also for the handler itself, so that a test can give it a config provider.
          Effect.provide(shell),
        ) as Effect.Effect<A>,
      );
  return {
    reconcile: call<R["Attributes"]>("reconcile"),
    delete: call<void>("delete"),
    read: call<R["Attributes"] | undefined>("read"),
    diff: call<{ action: string } | undefined>("diff"),
  };
};

/** Runs an effect with the live shell, or with a scripted one. */
export const run = <A, E>(effect: Effect.Effect<A, E, Shell>, shell: Layer.Layer<Shell> = ShellLive) =>
  Effect.runPromise(effect.pipe(Effect.provide(shell)));

type Reply = (
  line: string,
  calls: { line: string; stdin?: string; interruptAfterMs?: number }[],
) => string | Partial<ShellResult> | undefined;

/**
 * A `Shell` that records each command and answers from `reply`. `reply` gets
 * the command as one line and returns stdout, or a part of a result. Use it
 * for the commands that leave this computer: exe.dev, the Tailscale API, bb, npm.
 * A test file gives `layer` to `providers({ shell })` one time, and each test
 * gives its own replies with `script`, which also forgets the calls before it.
 */
export const scriptedShell = (first: Reply = () => undefined) => {
  let reply = first;
  const calls: { line: string; stdin?: string; interruptAfterMs?: number }[] = [];
  const layer = Layer.succeed(Shell, {
    run: (cmd, args, options) =>
      Effect.sync(() => {
        const line = [cmd, ...args].join(" ").replace(/^ssh (-o \S+ )*/, "ssh ");
        calls.push({ line, stdin: options?.stdin, interruptAfterMs: options?.interruptAfterMs });
        const answer = reply(line, calls) ?? "";
        return { code: 0, stdout: "", stderr: "", ...(typeof answer === "string" ? { stdout: answer } : answer) };
      }),
  });
  const script = (next: Reply) => {
    reply = next;
    calls.length = 0;
  };
  return { calls, layer, lines: () => calls.map((call) => call.line), script };
};

/**
 * A fake machine: a temporary directory as its home, and a fake `ssh` first on
 * PATH that runs the remote command on this computer in that home. A test then
 * runs the real script of a resource. Commands that would change a real machine
 * are fakes that record their arguments: `calls()` gives them in order.
 */
export const fakeMachine = (recorded: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), "tincto-test-"));
  const home = join(dir, "home");
  const log = join(dir, "log");
  const path = process.env.PATH;
  const bin = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  /** A fake command that records its arguments, then runs `then`. */
  const record = (name: string, then = "") => bin(name, `echo "${name} $*" >> "${log}"\n${then}`);
  /** Removes the home and the log, and makes the fakes as they were at the start. */
  const reset = () => {
    rmSync(home, { recursive: true, force: true });
    // Remove the log and each fake command that a test before this one made.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) rmSync(join(dir, entry.name));
    }
    mkdirSync(home);
    bin("ssh", `while [ "$1" = "-o" ]; do shift 2; done\nshift\nHOME="${home}" exec bash -c "$*"`);
    bin("sudo", `exec "$@"`);
    recorded.forEach((name) => record(name));
  };
  reset();
  process.env.PATH = `${dir}:${path}`;
  return {
    dir,
    home,
    bin,
    record,
    reset,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []),
    read: (file: string) => readFileSync(join(home, file), "utf8"),
    has: (file: string) => existsSync(join(home, file)),
    close: () => {
      process.env.PATH = path;
      rmSync(dir, { recursive: true });
    },
  };
};
export { stageAgents } from "./agents/stage.ts";
