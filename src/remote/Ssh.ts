import * as Effect from "effect/Effect";
import { quote, runOk } from "./Shell.ts";

// BatchMode makes ssh fail when it needs a person, for example when the key has no exe.dev account.
const sshOptions = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20"];

/**
 * The directories of the tools on the machine, as a shell expression. It is
 * the one PATH of this project: remote scripts and systemd user units use it.
 */
export const toolPath = "$HOME/.local/share/mise/shims:$HOME/.local/bin";

/** Runs an exe.dev lobby command, for example `ls --json`. */
export const lobby = (...args: string[]) => runOk("ssh", [...sshOptions, "exe.dev", ...args]);

/**
 * Runs a bash script on the machine. The script and the environment go
 * through stdin, so a secret is not in a process argument.
 */
export const runScript = (sshDest: string, script: string, env: Record<string, string> = {}) => {
  const exports = Object.entries(env).map(([name, value]) => `export ${name}=${quote(value)}\n`);
  const prelude = [
    "set -euo pipefail",
    // A non-login SSH session has no XDG_RUNTIME_DIR, which `systemctl --user` needs, and no tools on PATH.
    'export XDG_RUNTIME_DIR="/run/user/$(id -u)"',
    `export PATH="${toolPath}:$PATH"`,
  ].join("\n");
  // bash reads the script from stdin. The braces make bash read all of it before it
  // runs a command, and /dev/null stops a command (npx, apt-get) from reading the rest.
  return runOk("ssh", [...sshOptions, sshDest, "bash", "-s"], {
    stdin: `${prelude}\n${exports.join("")}{\n${script}\n} </dev/null\n`,
  });
};

/**
 * Runs a clean-up script on the machine and ignores a failure. A destroy must
 * not stop because the machine is gone already: then there is nothing to clean.
 */
export const cleanUp = (sshDest: string, script: string, env: Record<string, string> = {}) =>
  runScript(sshDest, script, env).pipe(Effect.ignore);

/**
 * Copies the content of a local directory into the home directory of the
 * machine. Directories that exist keep their mode: sshd refuses a key when the
 * home directory is writable by its group.
 */
export const uploadHome = (sshDest: string, localDir: string) =>
  runOk("bash", [
    "-c",
    `set -o pipefail; tar -C "$1" -cf - . | ssh ${sshOptions.join(" ")} "$2" 'tar -xf - --no-same-owner --no-same-permissions --no-overwrite-dir -C "$HOME"'`,
    "upload-home",
    localDir,
    sshDest,
  ]).pipe(Effect.asVoid);
