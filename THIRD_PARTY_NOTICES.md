# Third-party and artwork notices

Inventory checked on 2026-11-17 against the lockfile and installed Windows x64
packages. The source release does not vendor `node_modules`, native binaries,
an installer or a Windows service. Installing dependencies obtains their own
packages and notices. The built browser management bundle does include React,
React DOM, scheduler and clsx; their MIT notices are retained below and in the
linked license files. A source-only release is not a waiver of license terms.

| Component | Version / license | Notice and source |
| --- | --- | --- |
| dsh-pet upstream | pinned `a17346b9c41efb4220f387216008928bba652e0e`, MIT | Copyright (c) 2026 sereinmono and dsh-pet contributors; unchanged [LICENSE](LICENSE), [source](https://github.com/ysyyhhh/dsh-pet/tree/a17346b9c41efb4220f387216008928bba652e0e) |
| React / React DOM / scheduler (bundled in management) | 18.3.1 / 18.3.1 / 0.23.2, MIT | Copyright (c) Facebook, Inc. and its affiliates; [full MIT notice](docs/licenses/react-MIT.txt), [source](https://github.com/facebook/react) |
| clsx (bundled browser code) | 2.1.1, MIT | Copyright (c) Luke Edwards; [full MIT notice](docs/licenses/clsx-MIT.txt), [source](https://github.com/lukeed/clsx) |
| koffi | 3.1.5, MIT | Copyright (C) 2026 Niels Martignène; [full MIT notice](docs/licenses/koffi-MIT.txt), [source](https://github.com/Koromix/koffi); bundled dependency headers also retain node-api-headers (Copyright 2021 Node.js, MIT) and node-addon-api (Copyright 2017 Node.js API collaborators, MIT) notices in the npm package |
| sharp | 0.35.5, Apache-2.0 | Copyright 2013 Lovell Fuller and others; [full Apache license](docs/licenses/sharp-Apache-2.0.txt), [source](https://github.com/lovell/sharp/tree/v0.35.5) |
| @img/sharp-win32-x64 | 0.35.5, Apache-2.0 AND LGPL-3.0-or-later | [verbatim installed native notice table](docs/licenses/sharp-win32-x64-0.35.5.md), [exact version inventory](docs/licenses/sharp-win32-x64-0.35.5-versions.json); [native build sources](https://github.com/lovell/sharp-libvips), [npm package](https://www.npmjs.com/package/@img/sharp-win32-x64/v/0.35.5) |
| @img/sharp-wasm32 (optional, not Windows x64 runtime) | 0.35.5, Apache-2.0 AND LGPL-3.0-or-later AND MIT | Its own package README/LICENSE and native notices apply if distributed; installation presence is not evidence that Windows uses it |
| fflate | 0.8.3, MIT | Copyright (c) 2026 Arjun Barrett; license included in installed package, [source](https://github.com/101arrowz/fflate) |
| @deepseek-ai/schemastery; @deepseek-ai/cordis | 3.18.1; 4.0.1, MIT | Installed package licenses retained; Cordis is the preserved plugin peer/dev dependency, not a required application shell for the standalone manager |

## Native library obligations

The Windows sharp package contains libvips **8.18.7**, libheif **1.23.5** and
librsvg **2.63.2**, among the complete inventory linked above. There is no separate
`@img/sharp-libvips-win32-x64` package in this installation. The Windows package
notice describes libvips, libheif, librsvg, glib, pango, fribidi, libexif and
proxy-libintl as LGPLv3 via the any-later-version clauses of LGPLv2/2.1. It also
lists MPL 1.1 for cairo and BSD, MIT, Apache, patent, font, PNG, TIFF, IJG and zlib
terms for other native libraries. The bundle is not solely MIT or Apache.

Native redistribution must preserve the applicable notices/licenses and meet
the corresponding-source and user relinking/replacement requirements for the
actual distribution form. Before an installer or bundled-runtime release,
audit the exact native artifacts, supply the required source or compliant source
offer, and document how users can replace/relink LGPL components. This source
release does not make that binary-distribution claim.

Primary references: [LGPLv3](https://www.gnu.org/licenses/lgpl-3.0.html),
[GPLv3 incorporated terms](https://www.gnu.org/licenses/gpl-3.0.html),
[libvips source/license](https://github.com/libvips/libvips),
[sharp-libvips build/source recipes](https://github.com/lovell/sharp-libvips),
[sharp licensing](https://sharp.pixelplumbing.com/),
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
Recheck package-specific notices on any lockfile update; another OS/architecture
can carry a different set of native libraries.

## Artwork boundary

Only `assets/pets/text/pet.json` and its sprite sheet are bundled. The upstream
`scripts/generate-assets.mjs` records that this is original SVG text/color test
art, with no OpenAI/Codex/DeepSeek character art or trademarks. This provenance
does not authorize imported artwork. Petdex availability, a ZIP download or
user migration is not evidence of redistribution permission. Imported roles
remain under the private host directory and are excluded from Git/npm contents.
New bundled art needs an explicit author, source and redistribution license;
none has been inferred for external characters or future generated assets/fonts.
