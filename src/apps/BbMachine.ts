import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type { Providers } from "../Providers.ts";
import { provider, replaceOn } from "../remote/provider.ts";
import { quote, Shell } from "../remote/Shell.ts";
import { runScript } from "../remote/Ssh.ts";

export interface BbMachineProps {
  /** Name of the bb machine. */
  name: string;
  /** SSH destination of the machine. A new destination replaces the bb machine. */
  sshDest: string;
  /**
   * SSH destination of the computer that runs the bb server, for example
   * `me@bb-server`. Omit it when the bb server is on the computer that runs the stack.
   */
  serverSsh?: string;
}

export interface BbMachineAttributes {
  hostId: string;
  name: string;
}

/**
 * A bb machine: the machine, enrolled in a bb server on a different computer.
 * The resource uses the `bb` CLI of the computer that runs the server, and bb
 * installs its host daemon on the machine.
 */
export type BbMachine = Resource<"Bb.Machine", BbMachineProps, BbMachineAttributes, never, Providers>;
export const BbMachine = Resource<BbMachine>("Bb.Machine");

export class BbError extends Data.TaggedError("BbError")<{ message: string }> {}

/** A machine as the bb CLI prints it. bb names this record a host. */
interface BbRecord {
  id: string;
  name: string;
  lifecycle: { phase: string; message?: string };
}

/** Where the bb server is: its SSH destination, or nothing for this computer. */
type Server = string | undefined;

/** Runs the `bb` CLI of the computer that runs the bb server. */
const bb = (server: Server, args: string[], options?: { interruptAfterMs?: number }) =>
  Effect.gen(function* () {
    const shell = yield* Shell;
    return yield* server
      ? shell.run("ssh", ["-o", "BatchMode=yes", server, ["bb", ...args].map(quote).join(" ")], options)
      : shell.run("bb", args, options);
  });

const bbOk = (server: Server, args: string[]) =>
  bb(server, args).pipe(
    Effect.flatMap((result) =>
      result.code === 0
        ? Effect.succeed(result)
        : Effect.fail(
            new BbError({
              message: [
                `bb ${args.join(" ")} failed on ${server ?? "this computer"}: ${(result.stderr || result.stdout).trim().slice(-1000)}`,
                // A bb CLI that is not the one of the server is the usual cause.
                server
                  ? `Check that "ssh ${server} bb --version" works.`
                  : "The bb server must be on this computer. If it is on a different one, give `serverSsh`, for example me@bb-server.",
              ].join(" "),
            }),
          ),
    ),
  );

const show = (server: Server, hostId: string) =>
  bb(server, ["machine", "show", hostId, "--json"]).pipe(
    Effect.map((result) => (result.code === 0 ? (JSON.parse(result.stdout) as BbRecord) : undefined)),
  );

const create = ["machine", "create", "--provider", "manual", "--key"];

/**
 * bb prints the enrollment command only while `bb machine create` follows the
 * machine. The interrupt stops the follow as Ctrl+C does; the creation
 * continues, and the same key gives the same machine.
 */
const enrollmentCommand = (server: Server, key: string) =>
  Effect.gen(function* () {
    const result = yield* bb(server, [...create, key], { interruptAfterMs: 20_000 });
    const command = result.stderr.split("\n").find((line) => line.startsWith("curl "));
    if (!command) {
      return yield* new BbError({
        message: `bb did not print an enrollment command: ${(result.stderr || result.stdout).trim().slice(-1000)}`,
      });
    }
    return command;
  });

const waitUntilActive = (server: Server, hostId: string) =>
  show(server, hostId).pipe(
    Effect.flatMap((record) =>
      record?.lifecycle.phase === "active"
        ? Effect.succeed(record)
        : Effect.fail(
            new BbError({
              message: `bb machine ${hostId} is not active: ${record?.lifecycle.message ?? "bb does not show it"}`,
            }),
          ),
    ),
    Effect.retry({ schedule: Schedule.spaced("3 seconds"), times: 40 }),
  );

export const BbMachineProvider = provider(BbMachine, {
  diff: replaceOn<BbMachineProps>("sshDest"),
  read: Effect.fn(function* ({ olds, output }) {
    const record = output && (yield* show(olds.serverSsh, output.hostId));
    return record && { hostId: record.id, name: record.name };
  }),
  reconcile: Effect.fn(function* ({ news, output, instanceId }) {
    const key = `tincto-${instanceId}`;
    const server = news.serverSsh;
    let record = output && (yield* show(server, output.hostId));
    if (!record) {
      const created = yield* bbOk(server, [...create, key, "--no-wait", "--json"]);
      record = JSON.parse(created.stdout) as BbRecord;
    }
    if (record.lifecycle.phase !== "active") {
      yield* runScript(news.sshDest, yield* enrollmentCommand(server, key));
      record = yield* waitUntilActive(server, record.id);
    }
    if (record.name !== news.name) yield* bbOk(server, ["machine", "rename", record.id, news.name]);
    return { hostId: record.id, name: news.name };
  }),
  delete: Effect.fn(function* ({ olds, output }) {
    const server = olds.serverSsh;
    if (yield* show(server, output.hostId)) yield* bbOk(server, ["machine", "remove", output.hostId, "--yes"]);
  }),
});
