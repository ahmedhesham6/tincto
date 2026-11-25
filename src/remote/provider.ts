import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import type { ResourceClass, ResourceLike } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { Shell } from "./Shell.ts";

/** The lifecycle handlers of a resource. Each handler can use the `Shell`. */
export type Handlers<R extends ResourceLike> = Provider.ProviderServiceInput<R, Shell, Shell, never, Shell, Shell>;

/**
 * Makes the provider of a resource from its handlers. This is the one place
 * that knows how a handler gets the `Shell`: the Alchemy engine runs a handler
 * outside the layer that made it, so each handler must carry the shell with it.
 */
export const provider = <R extends ResourceLike>(
  resource: ResourceClass<R>,
  handlers: Handlers<R>,
): Layer.Layer<Provider.Provider<R>, never, Shell> =>
  Provider.effect(
    resource,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const bound: Record<string, unknown> = {};
      for (const [name, handler] of Object.entries(handlers)) {
        bound[name] =
          typeof handler === "function"
            ? (input: unknown) =>
                (handler as (input: unknown) => Effect.Effect<unknown, unknown, Shell>)(input).pipe(
                  Effect.provideService(Shell, shell),
                )
            : handler;
      }
      return bound as never;
    }),
  ) as never;

/**
 * A `diff` handler that replaces the resource when one of the given props
 * changes. Without it, a changed prop updates the resource in place.
 */
export const replaceOn =
  <Props>(...keys: (keyof Props)[]) =>
  ({ news, olds }: { news: unknown; olds: Props }) =>
    Effect.succeed(
      isResolved(news) && keys.some((key) => (news as Props)[key] !== olds[key])
        ? ({ action: "replace" } as const)
        : undefined,
    );
