import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider, replaceOn } from "../remote/provider.ts";
import { lobby } from "../remote/Ssh.ts";

export interface ExeVmKeyProps {
  /** Name of the exe.dev VM that the key opens. The key opens no other VM. */
  vm: string;
  /** The public key, as in a `.pub` file: type, key, and an optional comment with no spaces. */
  publicKey: string;
}

export interface ExeVmKeyAttributes {
  /** Fingerprint of the key, as exe.dev reports it. Destroy removes the key with it. */
  fingerprint: string;
}

/**
 * An SSH key of a different person in your exe.dev account, for one VM only
 * (`ssh-key add --vm`). The person connects with `ssh <vm>.exe.xyz`, and needs no
 * exe.dev account. A change of `vm` or `publicKey` replaces the key.
 */
export type ExeVmKey = Resource<"Exe.VmKey", ExeVmKeyProps, ExeVmKeyAttributes, never, Providers>;
export const ExeVmKey = Resource<ExeVmKey>("Exe.VmKey");

export class ExeVmKeyError extends Data.TaggedError("ExeVmKeyError")<{ message: string }> {}

/**
 * The reason when a text is not one public key. exe.dev reads its command line as a
 * shell does, so the key must have no character that a shell reads. `ExeHost` uses it,
 * so a bad key stops the plan and not the deploy.
 */
export const publicKeyProblem = (publicKey: string) =>
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-[a-z0-9@.-]+) [A-Za-z0-9+/]+=*( [A-Za-z0-9@._-]+)?$/.test(
    publicKey,
  )
    ? undefined
    : `"${publicKey.slice(0, 40)}" is not a public key. Give one line of a .pub file: type, key, and an optional comment with no spaces.`;

// The second word of a public key identifies it. The comment does not.
const body = (publicKey: string) => publicKey.split(" ")[1];

const find = (publicKey: string) =>
  lobby("ssh-key", "list", "--json").pipe(
    Effect.flatMap((result) =>
      Effect.try({
        try: () => JSON.parse(result.stdout) as { ssh_keys?: { public_key: string; fingerprint: string }[] },
        catch: () =>
          new ExeVmKeyError({ message: `exe.dev ssh-key list did not print JSON: ${result.stdout.slice(0, 500)}` }),
      }),
    ),
    Effect.map((json) => json.ssh_keys?.find((key) => body(key.public_key) === body(publicKey))),
  );

export const ExeVmKeyProvider = provider(ExeVmKey, {
  stables: ["fingerprint"],
  diff: replaceOn<ExeVmKeyProps>("vm", "publicKey"),
  reconcile: Effect.fn(function* ({ news, output }) {
    const problem = publicKeyProblem(news.publicKey);
    if (problem) return yield* new ExeVmKeyError({ message: problem });
    const found = yield* find(news.publicKey);
    if (found) {
      if (output?.fingerprint === found.fingerprint) return output;
      // A key that this stack did not add can be a key of the account owner, which opens
      // each VM. The stack must not take it: a destroy would then remove it.
      return yield* new ExeVmKeyError({
        message: `The key ${found.fingerprint} is in your exe.dev account already, and this stack did not add it. Remove it with "ssh exe.dev ssh-key remove ${found.fingerprint}", or use a different key.`,
      });
    }
    yield* lobby("ssh-key", "add", `--vm=${news.vm}`, `'${news.publicKey}'`);
    const added = yield* find(news.publicKey);
    if (!added)
      return yield* new ExeVmKeyError({
        message: `exe.dev added the key for ${news.vm}, but ssh-key list does not show it`,
      });
    return { fingerprint: added.fingerprint };
  }),
  // exe.dev removes the keys of a VM with the VM, so a key that is gone is no failure.
  delete: ({ output }) => lobby("ssh-key", "remove", output.fingerprint).pipe(Effect.ignore),
});
