// The components: what a stack yields.
export { type AgentConfig, Agents, type AgentsConfig } from "./agents/index.ts";
export { BbMachine, BbServer, T3Code } from "./apps/index.ts";
export type { ServeRule } from "./apps/TailscaleServe.ts";
export { after, type Host } from "./host/Host.ts";
export { ExeHost, machineName } from "./host/index.ts";
export { Serve, type ServeRequest, Tailnet } from "./network/index.ts";
export { collect, Providers, providers } from "./Providers.ts";
export { type Clone, Repos, type ReposProps } from "./repos/index.ts";
export { Toolchain, type ToolchainConfig, type Tools, toolVersion } from "./toolchain/index.ts";

// For a resource of your own: the provider frame, and how a provider reaches the machine.
export { authKey } from "./network/TailscaleDevice.ts";
export { provider, replaceOn } from "./remote/provider.ts";
export { Shell, ShellError, runOk } from "./remote/Shell.ts";
export { cleanUp, runScript, toolPath, uploadHome } from "./remote/Ssh.ts";
export * as userService from "./remote/userService.ts";
