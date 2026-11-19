// Zëvendësim minimal i @nestjs/common për provën në shfletues: dekoratorët vetëm regjistrojnë rrugët dhe parametrat,
// që kontrollorët e vërtetë të thirren pa server HTTP.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RouteDef { method: string; path: string; handler: string }
export interface ParamDef { kind: 'body' | 'query' | 'param' | 'req' | 'custom'; name?: string; pipe?: unknown; fn?: (data: unknown, ctx: any) => unknown }

const noopClass = () => (_t: any) => undefined;
export const Injectable = noopClass;
export const Global = noopClass;
export const Module = (_m?: unknown) => (_t: any) => undefined;
export const Catch = (..._a: unknown[]) => (_t: any) => undefined;
export const Inject = (_token?: unknown) => (_t: any, _k?: any, _i?: number) => undefined;

export const Controller = (prefix = '') => (cls: any) => { cls.__prefix = prefix; };
const route = (method: string) => (path = '') => (proto: any, handler: string) => {
  (Object.prototype.hasOwnProperty.call(proto, '__routes') ? proto.__routes : (proto.__routes = [])).push({ method, path, handler } as RouteDef);
};
export const Get = route('GET');
export const Post = route('POST');
export const Delete = route('DELETE');
export const HttpCode = (status: number) => (_p: any, _k: string, desc: PropertyDescriptor) => { desc.value.__status = status; };
export const SetMetadata = (key: string, value: unknown) => (target: any, _k?: string, desc?: PropertyDescriptor) => {
  const holder = desc ? desc.value : target;
  (holder.__meta ??= {})[key] = value;
};

const param = (def: ParamDef) => (proto: any, handler: string, index: number) => {
  const all = Object.prototype.hasOwnProperty.call(proto, '__params') ? proto.__params : (proto.__params = {});
  (all[handler] ??= [])[index] = def;
};
export const Body = () => param({ kind: 'body' });
export const Query = () => param({ kind: 'query' });
export const Req = () => param({ kind: 'req' });
export const Param = (name: string, pipe?: unknown) => param({ kind: 'param', name, pipe });
export class ParseIntPipe {}
export const createParamDecorator = (fn: (data: unknown, ctx: any) => unknown) => (data?: unknown) => param({ kind: 'custom', fn: (_d, ctx) => fn(data, ctx) });

export class HttpException extends Error {
  constructor(message: string, private readonly status: number) { super(message); }
  getStatus(): number { return this.status; }
}
// Tipe që kodi i vërtetë i importon vetëm si tipe.
export type ArgumentsHost = any; export type ExceptionFilter = any; export type ExecutionContext = any; export type CanActivate = any;
export type OnModuleInit = any; export type OnApplicationShutdown = any; export type OnApplicationBootstrap = any;
