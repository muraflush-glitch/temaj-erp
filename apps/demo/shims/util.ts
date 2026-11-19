/* eslint-disable @typescript-eslint/no-explicit-any */
export const promisify = (fn: any) => (...args: any[]) => new Promise((resolve, reject) => fn(...args, (err: unknown, value: unknown) => (err ? reject(err) : resolve(value))));
