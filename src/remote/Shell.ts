import { spawn } from "node:child_process";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ShellError extends Data.TaggedError("ShellError")<{
  message: string;
  command: string;
  code?: number;
  stderr?: string;
}> {}

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command on the computer that runs the stack. All contact with
 * exe.dev, the machine, the Tailscale API, npm and the bb CLI goes through
 * this service, so a test can replace it with a script of replies.
 */
export class Shell extends Context.Service<
  Shell,
  {
    run: (
      cmd: string,
      args: ReadonlyArray<string>,
      options?: {
        stdin?: string;
        /** Stop the command as Ctrl+C does after this time. The result is then what it printed until that time. */
        interruptAfterMs?: number;
      },
    ) => Effect.Effect<ShellResult, ShellError>;
  }
>()("tincto/Shell") {}

export const ShellLive = Layer.succeed(Shell, {
  run: (cmd, args, options) =>
    Effect.callback<ShellResult, ShellError>((resume) => {
      const command = [cmd, ...args].join(" ");
      const child = spawn(cmd, [...args], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => resume(Effect.fail(new ShellError({ message: error.message, command }))));
      child.on("close", (code) => resume(Effect.succeed({ code: code ?? 1, stdout, stderr })));
      // A child that exits before it reads stdin closes the pipe. The exit code reports it.
      child.stdin.on("error", () => {});
      child.stdin.end(options?.stdin ?? "");
      const timer = options?.interruptAfterMs && setTimeout(() => child.kill("SIGINT"), options.interruptAfterMs);
      child.on("close", () => clearTimeout(timer || undefined));
      return Effect.sync(() => {
        clearTimeout(timer || undefined);
        child.kill();
      });
    }),
});

/** Runs a command and fails when the exit code is not 0. */
export const runOk = (cmd: string, args: ReadonlyArray<string>, options?: { stdin?: string }) =>
  Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* shell.run(cmd, args, options);
    if (result.code !== 0) {
      const command = [cmd, ...args].join(" ");
      return yield* new ShellError({
        message: `${command} failed with exit code ${result.code}: ${(result.stderr || result.stdout).trim().slice(-2000)}`,
        command,
        code: result.code,
        stderr: result.stderr,
      });
    }
    return result;
  });

/** Quotes a value for a POSIX shell. */
export const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
