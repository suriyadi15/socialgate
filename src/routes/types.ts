import type { Feed } from '../feed';

/** A feed route: GET, answers JSON Feed, cached. */
export type RouteHandler = (params: Record<string, string>, query: Record<string, string>) => Promise<Feed>;
export type Routes = Record<string, RouteHandler>;

/** An action route (post, delete, session): answers plain JSON, never cached and never repeated. */
export type ActionHandler = (input: { params: Record<string, string>; query: Record<string, string>; body: unknown }) => Promise<unknown>;
export type ActionRoutes = Record<string, Partial<Record<'GET' | 'POST' | 'DELETE', ActionHandler>>>;
