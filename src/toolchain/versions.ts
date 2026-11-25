import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { runOk } from "../remote/Shell.ts";

export class VersionError extends Data.TaggedError("VersionError")<{ message: string }> {}

/** An exact version, such as `1.4.5` or `0.1.12-nightly.3`. All other versions are open. */
const exact = /^\d+\.\d+\.\d+/;

/**
 * The value for a `refresh` prop: the date of today. A resource that follows
 * the newest release gets it, so the first deploy of each day runs it again.
 */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Makes the tool list ready for mise.
 * - An npm tag (`latest`, `nightly`) becomes the exact version that npm has now, so the plan shows each upgrade.
 * - Other open versions (`24`, `latest`) stay. mise resolves them on the machine,
 *   and `refresh` makes mise run again on the first deploy of each day.
 */
export const resolveTools = <Tools extends Record<string, string>>(tools: Tools) =>
  Effect.gen(function* () {
    const resolved: Record<string, string> = {};
    for (const [name, version] of Object.entries(tools)) {
      resolved[name] =
        name.startsWith("npm:") && !exact.test(version) ? yield* npmVersion(name.slice(4), version) : version;
    }
    const open = Object.values(resolved).some((version) => !exact.test(version));
    return { tools: resolved as Tools, refresh: open ? today() : undefined };
  });

const npmVersion = (name: string, tag: string) =>
  runOk("npm", ["view", `${name}@${tag}`, "version"]).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.filterOrFail(
      (version) => exact.test(version),
      (version) => new VersionError({ message: `npm has no version for ${name}@${tag}: ${version}` }),
    ),
  );
