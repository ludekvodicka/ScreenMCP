# Third-party software

ScreenMCP is MIT-licensed. Its packaged application also contains the npm runtime dependencies
below. This inventory is generated from `package-lock.json`, including optional native packages
for every supported OS; the dependency licenses remain in force for their respective components.

## Direct runtime dependencies

- `@modelcontextprotocol/sdk@1.29.0`
- `@resvg/resvg-js@2.6.2`
- `@tesseract.js-data/eng@1.0.0`
- `electron-updater@6.8.9`
- `get-windows@9.3.0`
- `koffi@3.1.1`
- `react@19.2.7`
- `react-dom@19.2.7`
- `sharp@0.35.3`
- `tesseract.js@7.0.0`
- `zod@4.4.3`

## Native and WASM payloads

- `@resvg/resvg-js` and its platform bindings declare MPL-2.0.
- `sharp` declares Apache-2.0. Its platform packages can bundle libvips components declared under
  Apache-2.0, LGPL-3.0-or-later, and MIT as recorded below.
- `get-windows` ships a platform helper under its MIT package license.
- `koffi` ships prebuilt Node-API bindings under its MIT package license.
- `tesseract.js` and `tesseract.js-core` ship the Apache-2.0 OCR/WASM runtime; bundled English
  trained data comes from `@tesseract.js-data/eng` under MIT.

## Locked runtime inventory by declared license

### 0BSD

- `tslib@2.8.1`

### Apache-2.0

- `@img/sharp-darwin-arm64@0.35.3`
- `@img/sharp-darwin-x64@0.35.3`
- `@img/sharp-freebsd-wasm32@0.35.3`
- `@img/sharp-linux-arm@0.35.3`
- `@img/sharp-linux-arm64@0.35.3`
- `@img/sharp-linux-ppc64@0.35.3`
- `@img/sharp-linux-riscv64@0.35.3`
- `@img/sharp-linux-s390x@0.35.3`
- `@img/sharp-linux-x64@0.35.3`
- `@img/sharp-linuxmusl-arm64@0.35.3`
- `@img/sharp-linuxmusl-x64@0.35.3`
- `@img/sharp-webcontainers-wasm32@0.35.3`
- `detect-libc@2.1.2`
- `exponential-backoff@3.1.3`
- `idb-keyval@6.3.0`
- `sharp@0.35.3`
- `tesseract.js-core@7.0.0`
- `tesseract.js@7.0.0`
- `wasm-feature-detect@1.8.0`

### Apache-2.0 AND LGPL-3.0-or-later

- `@img/sharp-win32-arm64@0.35.3`
- `@img/sharp-win32-ia32@0.35.3`
- `@img/sharp-win32-x64@0.35.3`

### Apache-2.0 AND LGPL-3.0-or-later AND MIT

- `@img/sharp-wasm32@0.35.3`

### BlueOak-1.0.0

- `chownr@3.0.0`
- `isexe@3.1.5`
- `jackspeak@3.4.3`
- `minipass-flush@1.0.7`
- `minipass@7.1.3`
- `package-json-from-dist@1.0.1`
- `path-scurry@1.11.1`
- `sax@1.6.0`
- `tar@7.5.20`
- `yallist@5.0.0`

### BSD-2-Clause

- `http-cache-semantics@4.2.0`
- `json-schema-typed@8.0.2`
- `webidl-conversions@3.0.1`

### BSD-3-Clause

- `@mapbox/node-pre-gyp@2.0.3`
- `fast-uri@3.1.3`
- `qs@6.15.3`

### ISC

- `@isaacs/cliui@8.0.2`
- `@isaacs/fs-minipass@4.0.1`
- `@npmcli/agent@3.0.0`
- `@npmcli/fs@4.0.0`
- `abbrev@3.0.1`
- `cacache@19.0.1`
- `foreground-child@3.3.1`
- `fs-minipass@3.0.3`
- `glob@10.5.0`
- `graceful-fs@4.2.11`
- `inherits@2.0.4`
- `isexe@2.0.0`
- `lru-cache@10.4.3`
- `make-fetch-happen@14.0.3`
- `minimatch@9.0.9`
- `minipass-collect@2.0.1`
- `minipass-pipeline@1.2.4`
- `minipass-sized@1.0.3`
- `minipass@3.3.6`
- `nopt@8.1.0`
- `once@1.4.0`
- `proc-log@5.0.0`
- `semver@7.7.4`
- `semver@7.8.5`
- `setprototypeof@1.2.0`
- `signal-exit@4.1.0`
- `ssri@12.0.0`
- `unique-filename@4.0.0`
- `unique-slug@5.0.0`
- `which@2.0.2`
- `which@5.0.0`
- `wrappy@1.0.2`
- `yallist@4.0.0`
- `zod-to-json-schema@3.25.2`

### LGPL-3.0-or-later

- `@img/sharp-libvips-darwin-arm64@1.3.2`
- `@img/sharp-libvips-darwin-x64@1.3.2`
- `@img/sharp-libvips-linux-arm@1.3.2`
- `@img/sharp-libvips-linux-arm64@1.3.2`
- `@img/sharp-libvips-linux-ppc64@1.3.2`
- `@img/sharp-libvips-linux-riscv64@1.3.2`
- `@img/sharp-libvips-linux-s390x@1.3.2`
- `@img/sharp-libvips-linux-x64@1.3.2`
- `@img/sharp-libvips-linuxmusl-arm64@1.3.2`
- `@img/sharp-libvips-linuxmusl-x64@1.3.2`

### MIT

- `@emnapi/runtime@1.11.2`
- `@hono/node-server@1.19.14`
- `@img/colour@1.1.0`
- `@koromix/koffi-darwin-arm64@3.1.1`
- `@koromix/koffi-darwin-x64@3.1.1`
- `@koromix/koffi-freebsd-arm64@3.1.1`
- `@koromix/koffi-freebsd-ia32@3.1.1`
- `@koromix/koffi-freebsd-x64@3.1.1`
- `@koromix/koffi-linux-arm64@3.1.1`
- `@koromix/koffi-linux-ia32@3.1.1`
- `@koromix/koffi-linux-loong64@3.1.1`
- `@koromix/koffi-linux-riscv64@3.1.1`
- `@koromix/koffi-linux-x64@3.1.1`
- `@koromix/koffi-openbsd-ia32@3.1.1`
- `@koromix/koffi-openbsd-x64@3.1.1`
- `@koromix/koffi-win32-arm64@3.1.1`
- `@koromix/koffi-win32-ia32@3.1.1`
- `@koromix/koffi-win32-x64@3.1.1`
- `@modelcontextprotocol/sdk@1.29.0`
- `@tesseract.js-data/eng@1.0.0`
- `accepts@2.0.0`
- `agent-base@7.1.4`
- `ajv-formats@3.0.1`
- `ajv@8.20.0`
- `ansi-regex@5.0.1`
- `ansi-regex@6.2.2`
- `ansi-styles@4.3.0`
- `ansi-styles@6.2.3`
- `balanced-match@1.0.2`
- `bmp-js@0.1.0`
- `body-parser@2.3.0`
- `brace-expansion@2.1.2`
- `builder-util-runtime@9.7.0`
- `bytes@3.1.2`
- `call-bind-apply-helpers@1.0.2`
- `call-bound@1.0.4`
- `color-convert@2.0.1`
- `color-name@1.1.4`
- `consola@3.4.2`
- `content-disposition@1.1.0`
- `content-type@1.0.5`
- `content-type@2.0.0`
- `cookie-signature@1.2.2`
- `cookie@0.7.2`
- `cors@2.8.6`
- `cross-spawn@7.0.6`
- `debug@4.4.3`
- `depd@2.0.0`
- `dunder-proto@1.0.1`
- `eastasianwidth@0.2.0`
- `ee-first@1.1.1`
- `electron-updater@6.8.9`
- `emoji-regex@8.0.0`
- `emoji-regex@9.2.2`
- `encodeurl@2.0.0`
- `encoding@0.1.13`
- `env-paths@2.2.1`
- `err-code@2.0.3`
- `es-define-property@1.0.1`
- `es-errors@1.3.0`
- `es-object-atoms@1.1.2`
- `escape-html@1.0.3`
- `etag@1.8.1`
- `eventsource-parser@3.1.0`
- `eventsource@3.0.7`
- `express-rate-limit@8.5.2`
- `express@5.2.1`
- `fast-deep-equal@3.1.3`
- `fdir@6.5.0`
- `finalhandler@2.1.1`
- `forwarded@0.2.0`
- `fresh@2.0.0`
- `fs-extra@10.1.0`
- `function-bind@1.1.2`
- `get-intrinsic@1.3.0`
- `get-proto@1.0.1`
- `get-windows@9.3.0`
- `gopd@1.2.0`
- `has-symbols@1.1.0`
- `hasown@2.0.4`
- `hono@4.12.30`
- `http-errors@2.0.1`
- `http-proxy-agent@7.0.2`
- `https-proxy-agent@7.0.6`
- `iconv-lite@0.6.3`
- `iconv-lite@0.7.3`
- `imurmurhash@0.1.4`
- `ip-address@10.2.0`
- `ipaddr.js@1.9.1`
- `is-fullwidth-code-point@3.0.0`
- `is-promise@4.0.0`
- `is-url@1.2.4`
- `jose@6.2.3`
- `js-yaml@4.3.0`
- `json-schema-traverse@1.0.0`
- `jsonfile@6.2.1`
- `koffi@3.1.1`
- `lazy-val@1.0.5`
- `lodash.escaperegexp@4.1.2`
- `lodash.isequal@4.5.0`
- `math-intrinsics@1.1.0`
- `media-typer@1.1.0`
- `merge-descriptors@2.0.0`
- `mime-db@1.54.0`
- `mime-types@3.0.2`
- `minipass-fetch@4.0.1`
- `minizlib@3.1.0`
- `ms@2.1.3`
- `negotiator@1.0.0`
- `node-addon-api@8.9.0`
- `node-fetch@2.7.0`
- `node-gyp@11.4.2`
- `object-assign@4.1.1`
- `object-inspect@1.13.4`
- `on-finished@2.4.1`
- `opencollective-postinstall@2.0.3`
- `p-map@7.0.5`
- `parseurl@1.3.3`
- `path-key@3.1.1`
- `path-to-regexp@8.4.2`
- `picomatch@4.0.5`
- `pkce-challenge@5.0.1`
- `promise-retry@2.0.1`
- `proxy-addr@2.0.7`
- `range-parser@1.3.0`
- `raw-body@3.0.2`
- `react-dom@19.2.7`
- `react@19.2.7`
- `regenerator-runtime@0.13.11`
- `require-from-string@2.0.2`
- `retry@0.12.0`
- `router@2.2.0`
- `safer-buffer@2.1.2`
- `scheduler@0.27.0`
- `send@1.2.1`
- `serve-static@2.2.1`
- `shebang-command@2.0.0`
- `shebang-regex@3.0.0`
- `side-channel-list@1.0.1`
- `side-channel-map@1.0.1`
- `side-channel-weakmap@1.0.2`
- `side-channel@1.1.1`
- `smart-buffer@4.2.0`
- `socks-proxy-agent@8.0.5`
- `socks@2.8.9`
- `statuses@2.0.2`
- `string-width-cjs@4.2.3`
- `string-width@4.2.3`
- `string-width@5.1.2`
- `strip-ansi-cjs@6.0.1`
- `strip-ansi@6.0.1`
- `strip-ansi@7.2.0`
- `tiny-typed-emitter@2.1.0`
- `tinyglobby@0.2.17`
- `toidentifier@1.0.1`
- `tr46@0.0.3`
- `type-is@2.1.0`
- `universalify@2.0.1`
- `unpipe@1.0.0`
- `vary@1.1.2`
- `whatwg-url@5.0.0`
- `wrap-ansi-cjs@7.0.0`
- `wrap-ansi@8.1.0`
- `zlibjs@0.3.1`
- `zod@4.4.3`

### MPL-2.0

- `@resvg/resvg-js-android-arm-eabi@2.6.2`
- `@resvg/resvg-js-android-arm64@2.6.2`
- `@resvg/resvg-js-darwin-arm64@2.6.2`
- `@resvg/resvg-js-darwin-x64@2.6.2`
- `@resvg/resvg-js-linux-arm-gnueabihf@2.6.2`
- `@resvg/resvg-js-linux-arm64-gnu@2.6.2`
- `@resvg/resvg-js-linux-arm64-musl@2.6.2`
- `@resvg/resvg-js-linux-x64-gnu@2.6.2`
- `@resvg/resvg-js-linux-x64-musl@2.6.2`
- `@resvg/resvg-js-win32-arm64-msvc@2.6.2`
- `@resvg/resvg-js-win32-ia32-msvc@2.6.2`
- `@resvg/resvg-js-win32-x64-msvc@2.6.2`
- `@resvg/resvg-js@2.6.2`

### Python-2.0

- `argparse@2.0.1`

License identifiers are SPDX expressions copied from the exact lock entries. Full license
texts are retained in the installed npm packages and are available from each package source.

