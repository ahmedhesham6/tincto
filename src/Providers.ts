import * as Command from "alchemy/Command";
import * as Provider from "alchemy/Provider";
import type * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { Home, HomeProvider } from "./agents/Home.ts";
import { Plugins, PluginsProvider } from "./agents/Plugins.ts";
import { Skills, SkillsProvider } from "./agents/Skills.ts";
import { BbMachine, BbMachineProvider } from "./apps/BbMachine.ts";
import { BbPlugin, BbPluginProvider } from "./apps/BbPlugin.ts";
import { BbServer, BbServerProvider } from "./apps/BbServer.ts";
import { T3Code, T3CodeProvider } from "./apps/T3Code.ts";
import { T3Project, T3ProjectProvider } from "./apps/T3Project.ts";
import { TailscaleServe, TailscaleServeProvider } from "./apps/TailscaleServe.ts";
import { ExeVm, ExeVmProvider } from "./host/ExeVm.ts";
import { ExeVmKey, ExeVmKeyProvider } from "./host/ExeVmKey.ts";
import { TailscaleDevice, TailscaleDeviceProvider } from "./network/TailscaleDevice.ts";
import { type Shell, ShellLive } from "./remote/Shell.ts";
import { GitHubLogin, GitHubLoginProvider } from "./repos/GitHubLogin.ts";
import { GitRepo, GitRepoProvider } from "./repos/GitRepo.ts";
import { AptPackages, AptPackagesProvider } from "./toolchain/AptPackages.ts";
import { Mise, MiseProvider } from "./toolchain/Mise.ts";
import { SystemService, SystemServiceProvider } from "./toolchain/SystemService.ts";

/** The collection that holds the provider of each resource of tincto. */
export class Providers extends Provider.ProviderCollection<Providers>()("Tincto") {}

/** Each resource with its provider. To add a resource, add one line here. */
const all = [
  [ExeVm, ExeVmProvider],
  [ExeVmKey, ExeVmKeyProvider],
  [TailscaleDevice, TailscaleDeviceProvider],
  [AptPackages, AptPackagesProvider],
  [SystemService, SystemServiceProvider],
  [Mise, MiseProvider],
  [Home, HomeProvider],
  [Skills, SkillsProvider],
  [Plugins, PluginsProvider],
  [GitHubLogin, GitHubLoginProvider],
  [GitRepo, GitRepoProvider],
  [T3Code, T3CodeProvider],
  [T3Project, T3ProjectProvider],
  [BbServer, BbServerProvider],
  [BbPlugin, BbPluginProvider],
  [BbMachine, BbMachineProvider],
  [TailscaleServe, TailscaleServeProvider],
] as const;

/**
 * Makes the provider layer of a collection: each resource with its provider,
 * and the `Shell` that the providers use: the live one, unless a test gives a different one. A package with resources of its
 * own makes its `providers()` with it, and a stack merges the layers:
 * `Layer.mergeAll(Tincto.providers(), Other.providers())`.
 */
export const collect = <Self>(
  collection: Context.Key<Self, Provider.ProviderCollectionService>,
  entries: readonly (readonly [unknown, unknown])[],
  shell: Layer.Layer<Shell> = ShellLive,
) =>
  Layer.effect(collection, Provider.collection(entries.map(([resource]) => resource) as never)).pipe(
    Layer.provide(
      Layer.mergeAll(...(entries.map(([, provider]) => provider) as unknown as [Layer.Layer<never, never, Shell>])),
    ),
    Layer.provide(shell),
  ) as Layer.Layer<Self>;

/**
 * The providers for all resources of tincto, and the Command providers of Alchemy. A test gives a `shell` of its own,
 * for the commands that leave the computer of the test.
 */
export const providers = (options: { shell?: Layer.Layer<Shell> } = {}) =>
  // With the Command providers of Alchemy, as the provider packages of Alchemy have them:
  // a stack can use `Command.Exec` and `Command.Build` with no more setup.
  Layer.mergeAll(collect(Providers, all, options.shell), Command.providers());
