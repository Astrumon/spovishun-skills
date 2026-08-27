# NOTICE

`spovishun-skills` is MIT licensed (see `LICENSE`). Parts of it are **derived from other open-source
projects** — MIT and Apache-2.0, one section per upstream below. This file records what was adapted,
from where, under which licence, and at which upstream revision.

Nothing here is a verbatim copy: the upstream bodies were rewritten to this plugin's artifact model
(`SKILL.md` + `manifest.yaml`, normative statements moved into `rules/`) and re-scoped from Android to
Kotlin Multiplatform. The attribution is required all the same.

One artifact may draw on more than one upstream — `skills/compose-multiplatform` appears under two
sections — in which case its `manifest.yaml` carries a `source:` **list**, one entry per repository.

Every artifact listed below carries a matching `source:` block in its `manifest.yaml`.
`scripts/validate-all-manifests.js` enforces the correspondence in **both** directions — a manifest
with `source:` that is missing here fails `npm run lint`, and so does a row here with no such
manifest. `scripts/check-upstream-drift.js` re-reads the pinned SHAs from the GitHub API and reports
any that have moved.

---

## rcosteira79/android-skills

- **Repository:** https://github.com/rcosteira79/android-skills
- **License:** MIT
- **Adapted at ref:** `6373e59c1dcdb28fe94649e7db59055a5052f4db`

| Artifact | Upstream path | Blob SHA |
|---|---|---|
| `skills/ktor-client-kmp` | `plugins/android-skills/skills/kmp-ktor/SKILL.md` | `9b8943f73011d5dd38d325e866fc8c4c000417d4` |
| `skills/compose-multiplatform` | `plugins/android-skills/skills/compose/references/state-management.md` | `224843171c18b85ac98168946b9af488c55f2622` |
| `skills/compose-multiplatform` | `plugins/android-skills/skills/compose/references/performance.md` | `cf6a2477519f54e72a8f36d4ef9577f8c9c4615e` |
| `skills/compose-multiplatform` | `plugins/android-skills/skills/compose/references/lists-scrolling.md` | `a723a3f8784c265ff35889938544fc1e73a0357f` |
| `skills/compose-multiplatform` | `plugins/android-skills/skills/compose/references/modifiers.md` | `d7cc8e779804d7460e5d7f1b57e639ba7148b2ab` |
| `skills/kmp-persistence` | `plugins/android-skills/skills/datastore/SKILL.md` | `1490ab1747272a11043c4b54accce8eee45ed707` |
| `skills/kmp-persistence` | `plugins/android-skills/skills/android-data-layer/SKILL.md` | `2d51cc5e191718f5e24929ec2db98850c3f6cc87` |
| `skills/kmp-ios-interop` | `plugins/android-skills/skills/kmp-boundaries/references/ios-interop.md` | `601fc24e18a66d901c9843999ac45a043eb11843` |
| `skills/koin-kmp` | `plugins/android-skills/skills/koin/SKILL.md` | `f9eaad00844fe8009fdabd22678d556b71bfd3fc` |
| `skills/kmp-testing` | `plugins/android-skills/skills/android-testing/SKILL.md` | `033cde57206353a57ded7b22a8a0a1250be268e4` |

### Upstream license (verbatim)

```
MIT License

Copyright (c) 2026 Ricardo Costeira

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Nerushok/ComArch

- **Repository:** https://github.com/Nerushok/ComArch
- **License:** MIT
- **Adapted at ref:** `7a3e3d5cbde460ccc3ed41a08f2a0450b0d7d0b0`

Accompanies the article [Компонентна архітектура для Android](https://dou.ua/forums/topic/52382/) by
Sergii Nerush. `references/component-architecture.md` reworks the four library files below for
`commonMain` — the store key stops going through `java.canonicalName`, the coroutine scope takes an
injected dispatcher and `CoroutineExceptionHandler`, and Hilt `@AssistedFactory` is replaced by Koin
factory-function bindings.

| Artifact | Upstream path | Blob SHA |
|---|---|---|
| `skills/kmp-multiplatform-specialist` | `library/src/main/kotlin/lib/nerush/components/library/Component.kt` | `dfd7fc595c0879ca9e2444709ad35dfdd702c33e` |
| `skills/kmp-multiplatform-specialist` | `library/src/main/kotlin/lib/nerush/components/library/ComponentStore.kt` | `85c04c7f1a81b08d3191e617dfcc8951c9ac1cd5` |
| `skills/kmp-multiplatform-specialist` | `library/src/main/kotlin/lib/nerush/components/library/ComponentStoreOwner.kt` | `40df2fbb4bdbfc8211378bb9832b20e135253348` |
| `skills/kmp-multiplatform-specialist` | `library/src/main/kotlin/lib/nerush/components/library/BaseComponent.kt` | `8e3bdd2bc3dc0a93df45894a2b05f22d0d5774e3` |

### Upstream license (verbatim)

```
MIT License

Copyright (c) 2024 Serhii

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## skydoves/compose-stability-analyzer

- **Repository:** https://github.com/skydoves/compose-stability-analyzer
- **License:** Apache-2.0
- **Adapted at ref:** `aadca58d362f012d226684b27c976cbaf0905add`

`skills/compose-multiplatform/references/stability-baselines.md` is written from the upstream
documentation for the Gradle plugin: the `stabilityDump` / `stabilityCheck` baseline gate, the
`stabilityValidation` options, `@TraceRecomposition`, the per-target support matrix, and the
Kotlin ↔ analyzer version map. The prose, the framing and every "Do NOT" are this repo's own; the
task names, DSL option names, log format and version table are upstream facts.

| Artifact | Upstream path | Blob SHA |
|---|---|---|
| `skills/compose-multiplatform` | `docs/gradle-plugin/stability-validation.md` | `efc539f4ac602d8cecf05bd9913d1c073a98e2d0` |
| `skills/compose-multiplatform` | `docs/gradle-plugin/trace-recomposition.md` | `67f389d278f1c8ca5646065745bbd3d5995d72f8` |
| `skills/compose-multiplatform` | `docs/gradle-plugin/kotlin-multiplatform.md` | `e3d25c776a28aa1b4d8535dfe42ea6a0cf37a1c4` |
| `skills/compose-multiplatform` | `docs/gradle-plugin/ci-cd.md` | `390c5f789def3fc15b0dcd014fe817b52066d91c` |
| `skills/compose-multiplatform` | `docs/gradle-plugin/stability-configuration-files.md` | `93264ec2f25bf5948e5a8e48acf7441cffe945b2` |
| `skills/compose-multiplatform` | `docs/gradle-plugin/getting-started.md` | `b73f1a210e2d30e13227970ec9c97f76692a2af1` |
| `skills/compose-multiplatform` | `docs/version-map.md` | `d484c9dda8ff8dc278d1a1d7456ef925cf33dc25` |

### Upstream NOTICE (verbatim)

Reproduced as Section 4(d) of the Apache License 2.0 requires.

```
Compose Stability Analyzer
Copyright 2026 skydoves (Jaewoong Eum)
https://github.com/skydoves/compose-stability-analyzer

This product includes software designed and developed by
skydoves (Jaewoong Eum). Per Section 4(d) of the Apache License 2.0,
redistributions and derivative works of this software must retain
this NOTICE file and the attribution notices it contains.
```

### Upstream license

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The full license text is at https://www.apache.org/licenses/LICENSE-2.0 and in the upstream
repository's `LICENSE` file.

---

## Vendored dependencies

| File | Upstream | License |
|---|---|---|
| `scripts/notion/lib/vendor/marked.cjs` | [markedjs/marked](https://github.com/markedjs/marked), pinned in `package.json` | MIT |

Kept byte-identical to the installed `marked` package by `scripts/check-vendored-marked.js`; regenerate
with `node scripts/vendor-marked.js`.
