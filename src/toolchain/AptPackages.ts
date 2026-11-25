import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { runScript } from "../remote/Ssh.ts";

export interface AptPackagesProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Debian package names. */
  packages: string[];
}

/** A set of apt packages on the machine. Destroy leaves them: other software can need them. */
export type AptPackages = Resource<"Toolchain.AptPackages", AptPackagesProps, { packages: string[] }, never, Providers>;
export const AptPackages = Resource<AptPackages>("Toolchain.AptPackages");

const install = `export DEBIAN_FRONTEND=noninteractive
if ! dpkg -s $PACKAGES >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq $PACKAGES
fi`;

export const AptPackagesProvider = provider(AptPackages, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, install, { PACKAGES: news.packages.join(" ") });
    return { packages: news.packages };
  }),
  delete: () => Effect.void,
});
