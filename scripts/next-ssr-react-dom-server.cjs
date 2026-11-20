"use strict";

require("./align-next-ssr-react.cjs");

module.exports = require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js").vendored[
  "react-ssr"
].ReactDOMServer;
