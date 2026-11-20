"use strict";

// Next's production prerender renders client components with the app's
// react-dom (React 19.3.1) while the App Router SSR graph calls hooks on the
// separate React copy bundled inside the Turbopack app-page runtime. The
// renderer sets the dispatcher on the first copy, so useContext on the second
// throws "Cannot read properties of null (reading 'useContext')" while
// prerendering /_global-error. Point the Node renderer at that bundled copy.
// Development keeps the app's React.

if (globalThis.__WORDLY_SSR_REACT_ALIGNED__) {
  return;
}
globalThis.__WORDLY_SSR_REACT_ALIGNED__ = true;

const fs = require("fs");
const Module = require("module");
const path = require("path");

const RUNTIME = require.resolve("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js");
const NEEDLE = "t.prerender=n.prerender,n.resumeAndPrerenderToNodeStream,n.resumeAndPrerender";
const CAPTURE = "globalThis.__WORDLY_BUNDLED_REACT_DOM_STATIC__=t";
const serverShim = path.join(__dirname, "next-ssr-react-dom-server.cjs");
const staticShim = path.join(__dirname, "next-ssr-react-dom-static.cjs");
const aliases = new Map([
  ["react-dom/server", serverShim],
  ["react-dom/static", staticShim],
]);

const originalJs = Module._extensions[".js"];
Module._extensions[".js"] = function compileAlignedRuntime(module, filename) {
  if (path.resolve(filename) !== path.resolve(RUNTIME)) {
    return originalJs(module, filename);
  }
  const source = fs.readFileSync(filename, "utf8");
  if (!source.includes(NEEDLE)) {
    throw new Error(
      "Could not align the Next.js SSR React used to prerender /_global-error. The bundled static renderer in the app-page runtime changed.",
    );
  }
  const patched = source.includes(CAPTURE) ? source : source.replace(NEEDLE, `${NEEDLE},${CAPTURE}`);
  module._compile(patched, filename);
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveAlignedRenderer(request, parent, isMain, options) {
  if (process.env.NODE_ENV === "production") {
    const mapped = aliases.get(request);
    if (mapped) return mapped;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
