# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/eziebatozai/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/eziebatozai/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama protocol snapshot, scores every protocol that records no token
with its category's own market multiple, ranks 250 of them by implied value, and gives each one a farm plan with
the cost and the time of every step. The dashboard is plain HTML, CSS and JavaScript: a board, a protocol's detail,
the token-lane and the model, each on its own hash route.

## Run it

```sh
node main.ts --input /input/snapshot.json          # the grader's mount
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json   # locally
```

`main.ts` writes `board.json`, `data.js`, the dashboard, the screenshots and `dossier.json` into `/output`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s90m223q&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
