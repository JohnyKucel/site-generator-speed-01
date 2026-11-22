# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/JohnyKucel/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/JohnyKucel/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: `solve.js` answers
exactly as makefun-site does on every case — same front matter rules, same
template dialect, same Markdown subset, same slug rule, same build report —
at a fraction of the CPU.

Full reimplementation of `build()` from scratch, stdlib only: single-scan
inline Markdown with plain runs pushed raw, fused lex+render without token
objects, `indexOf` front-matter scanning, cached slugify with an ASCII fast
path, templates compiled once per build into a flat op-array, cards built
once per post. No dependencies, no eval, no WASM, no clock, no environment,
no randomness, no state between `run()` calls.

Local check on the practice set (3 cases, 257/348/486 files): 3/3 identical
to the oracle, ~150 ms CPU for `run()` vs ~483 ms for the house baseline
(~3.2x faster); end to end via `main.ts` ~575 ms vs ~1,115 ms (~1.9x).
Also verified on 12 freshly drawn fuzz cases from the kit generator and 15
handcrafted differential cases against the baseline, all byte-identical.
Two runs write byte-identical answers.

## Run it

```sh
node main.ts
```

`main.ts` reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`) and writes
`/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`). Node 22,
dependency-free, stdlib only.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jy3a6hm3&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
