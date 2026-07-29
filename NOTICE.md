# NOTICE

`spovishun-skills` is MIT licensed (see `LICENSE`). Parts of it are **derived from other MIT-licensed
projects**. This file records what was adapted, from where, and at which upstream revision.

Nothing here is a verbatim copy: the upstream bodies were rewritten to this plugin's artifact model
(`SKILL.md` + `manifest.yaml`, normative statements moved into `rules/`) and re-scoped from Android to
Kotlin Multiplatform. The attribution is required all the same.

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

## Vendored dependencies

| File | Upstream | License |
|---|---|---|
| `scripts/notion/lib/vendor/marked.cjs` | [markedjs/marked](https://github.com/markedjs/marked), pinned in `package.json` | MIT |

Kept byte-identical to the installed `marked` package by `scripts/check-vendored-marked.js`; regenerate
with `node scripts/vendor-marked.js`.
