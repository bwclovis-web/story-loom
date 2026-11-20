"use strict";

require("./align-next-ssr-react.cjs");
require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js");

const captured = globalThis.__WORDLY_BUNDLED_REACT_DOM_STATIC__;
if (!captured || typeof captured.prerender !== "function") {
  throw new Error(
    "Could not find the bundled react-dom/static prerender that matches the App Router SSR React.",
  );
}

module.exports = captured;
