# JTTY local run and API reconstruction report

## Conclusion

`assets-dump-2026-05-20T00-58-45-506Z` is not a complete editable project. It is a browser-captured web build/resource dump:

- Present: `assets-log.json`, 169 JSON files, 28 JS files, 7 CSS files, images/audio, Cocos bundle configs.
- Missing: original HTML launcher, original Cocos Creator project files (`assets/`, `.meta`, `project.json`, TypeScript/source scripts), backend service, and original request bodies/headers.
- Current state: cannot be run directly by double-clicking or serving the folder as static files.

It can likely be made locally replayable, but that is a reconstruction task, not a normal `npm install && npm run dev` task.

## What is needed to run locally

Minimum local replay path:

1. Reconstruct a launcher HTML that loads the captured loader/runtime scripts in the same order as the original page.
2. Serve captured files under paths matching `assets-log.json`, especially:
   - `https://m.eajzzxhro.com/loader/04.js`
   - `https://static.eajzzxhro.com/shared/984721902a/index.json`
   - `https://static.eajzzxhro.com/1804577/assets/main/config.2e604.json`
   - `https://static.eajzzxhro.com/1804577/assets/resources/config.c5c2c.json`
3. Provide an API backend or proxy for `api.eajzzxhro.com` routes listed below.
4. Either use local DNS/hosts plus HTTPS reverse proxy for the original hostnames, or patch/redirect the runtime to local hostnames.
5. Accept that this dump only proves the captured path. It does not contain full source, editor metadata, or guaranteed coverage for unvisited game states.

Resource evidence:

- `resources` bundle config references 374 paths, 2580 UUIDs, 270 import version pairs, 231 native version pairs, and 185 packs.
- The local dump contains enough assets for the captured session, but it is not an authoritative full Creator source project.

## Can API names be changed?

Yes, but the recommended route is backend compatibility or proxy rewriting, not editing the minified game bundle.

Best options:

1. Backend implements aliases with the same observed paths. This is the safest.
2. A reverse proxy rewrites observed paths to your internal route names.
3. Some base paths are returned by `verifySession` (`geu`, `bau`, `lau`), so the backend can point the client at different base prefixes if the suffixes stay compatible.
4. Directly editing endpoint names inside the packed JS is possible but brittle. The main game file is minified/obfuscated (`index.24e03.3c97611f955f.js`, about 2.2 MB), and source-level route constants are not available.

## Observed API endpoints

All observed API responses have this envelope:

```json
{
  "dt": {},
  "err": null
}
```

`assets-log.json` does not record HTTP method or request body. During backend compatibility, accept both GET and POST initially, tolerate `traceId` query params, and log actual client payloads once the reconstructed local page is running.

| Count | Observed path |
| ---: | --- |
| 1 | `/web-api/auth/session/v2/verifySession` |
| 1 | `/web-api/game-proxy/v2/GameName/Get` |
| 1 | `/game-api/graffiti-rush/v2/GameInfo/Get` |
| 1 | `/web-api/game-proxy/v2/Resources/GetByResourcesTypeIds` |
| 53 | `/game-api/graffiti-rush/v2/Spin` |
| 1 | `/web-api/game-proxy/v2/BetSummary/Get` |
| 1 | `/web-api/game-proxy/v2/BetHistory/Get` |
| 1 | `/web-api/game-proxy/v2/GameRule/Get` |

All observed API calls used `?traceId=...20`.

## Key response shapes

### `verifySession`

Important fields:

- `dt.tk`: session token.
- `dt.st`: session status.
- `dt.geu`: game API base path, observed as `game-api/graffiti-rush/`.
- `dt.bau`: proxy API base path, observed as `web-api/game-proxy/`.
- `dt.lau`: lobby API base path, observed as `/game-api/lobby/`.
- `dt.cc`: currency, observed as `PGC`.
- `dt.gm[]`: available game metadata. Current game `gid` is `1804577`.

Observed sample file:

- `files/verifySession.1fa150c55447.json`

Note: the captured `dt.tk` value in this sample was replaced with `SANITIZED_CAPTURE_TOKEN` before committing.

### `GameInfo/Get`

Important fields:

- `dt.cs`: coin sizes, observed `[0.03, 0.1, 0.3, 0.9]`.
- `dt.ml`: multiplier levels, observed `[1..10]`.
- `dt.mxl`: max multiplier level, observed `10`.
- `dt.maxwm`: max win multiplier, observed `5000`.
- `dt.wt`: win threshold table.
- `dt.bl`: balance.
- `dt.ls.si`: last spin state.
- `dt.cc`: currency.

Observed sample file:

- `files/Get.df5d398a5d91.json`

### `Spin`

Important state fields under `dt.si`:

- result arrays: `rl`, `orl`
- win data: `wp`, `lw`, `lwam`, `rwsp`, `ctw`, `tw`, `aw`
- bet data: `cs`, `ml`, `tb`, `tbb`
- balance data: `blb`, `blab`, `bl`, `np`
- round/session ids: `sid`, `psid`
- state markers: `st`, `nst`, `pf`, `wt`, `wk`, `ge`, `gwt`
- optional feature fields: `fs`, `sp`, `nsp`, `fb`, `pmt`, `mr`, `ocr`

Observed spin examples are all base-game style responses. No complete free-spin flow was captured.

Observed sample files:

- `files/Spin.c2f3ab200256.json`
- `files/Spin.caad45284449.json`

### `BetSummary/Get`

Important fields:

- `dt.lut`: last update timestamp.
- `dt.bs.gid`: game id.
- `dt.bs.bc`: bet count.
- `dt.bs.btba`: total bet amount.
- `dt.bs.btwa`: total win amount.
- `dt.bs.btwla`: total net win/loss amount.
- `dt.bs.lbid`: last bet id.

Observed sample file:

- `files/Get.d22e6f3435d2.json`

### `BetHistory/Get`

Important fields:

- `dt.bh[]`: bet history rows.
- Each row includes `tid`, `gid`, `cc`, `gtba`, `gtwla`, `gtwa`, `bt`, `ge`, `bd[]`.
- `bd[].gd` uses the same shape as `Spin.dt.si`.

Observed sample file:

- `files/Get.8abd9c585edf.json`

### `GameRule/Get`

Important fields:

- `dt.rtp.Default.min`
- `dt.rtp.Default.max`
- `dt.grtpi[]`
- `dt.ows`
- `dt.jws`

Observed sample file:

- `files/Get.1da82f6ec2f5.json`

### `Resources/GetByResourcesTypeIds`

Response is an array of:

```json
{
  "rid": 1804577,
  "rtid": 14,
  "url": "https://public.eajzzxhro.com/pages/static/image/en/SocialGameSmall/graffiti-rush/SGS-a2cbc616.png",
  "l": "en-US",
  "ut": "2025-04-30T08:04:26"
}
```

Observed sample file:

- `files/GetByResourcesTypeIds.41df307233eb.json`

## Backend implementation recommendation

For the first runnable local version, implement a compatibility layer with the observed route names and response envelopes. Keep the backend route internals whatever you prefer, but expose or proxy the observed PG-style paths at the edge:

- `/web-api/auth/session/v2/verifySession`
- `/game-api/graffiti-rush/v2/GameInfo/Get`
- `/game-api/graffiti-rush/v2/Spin`
- `/web-api/game-proxy/v2/BetSummary/Get`
- `/web-api/game-proxy/v2/BetHistory/Get`
- `/web-api/game-proxy/v2/GameRule/Get`
- `/web-api/game-proxy/v2/GameName/Get`
- `/web-api/game-proxy/v2/Resources/GetByResourcesTypeIds`

Then make `verifySession.dt.geu` and `verifySession.dt.bau` match those exposed prefixes. This avoids editing the packed frontend.
