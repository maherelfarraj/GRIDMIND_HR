// Vitest setup: static image assets are `require()`d at runtime (Metro
// behavior), which bypasses Vite's resolve aliases and hits Node's CJS
// resolver. Redirect any image require to a stub module.
import Module from 'node:module';
import path from 'node:path';

const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...rest: unknown[]
) {
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(request)) {
    return path.resolve(__dirname, 'file-stub.cjs');
  }
  return originalResolve.call(this, request, ...rest);
};
