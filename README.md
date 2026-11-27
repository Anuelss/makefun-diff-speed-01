# makefun-diff-speed-01

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Anuelss/makefun-diff-speed-01/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Anuelss/makefun-diff-speed-01/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: byte-identical line-diff patches at about 2.2x less CPU time on the practice set. It implements exactly makefun-diff's rule — lines cut after every `\n`, common prefix then suffix trimmed, Myers's greedy search with deletion winning ties and no edge pruning, patch with 3 lines of context — but runs the search on interned line ids (integer equality) with the furthest-x values held in small per-distance padded `Int32Array` slices instead of one heap object per path per diagonal. Dependency-free, no I/O, no state kept between cases.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0ztfhqkk&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
