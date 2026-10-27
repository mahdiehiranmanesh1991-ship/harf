# «حرف» — Harf PWA

Writing pad + Persian voice typing with a personal on-device memory, installable on iPhone via Safari → Share → **Add to Home Screen**.
Workflow: write or speak in Harf → one-tap **Copy** (or Share) → paste anywhere. A web app cannot replace the iOS system keyboard; Harf adds a suggestion bar + ZWNJ/Persian punctuation row pinned above it (visualViewport).

## Features
- Big RTL editor (Vazirmatn, local), draft autosave
- Suggestion bar: completions (memory + legal seed lexicon), next-word (bigrams), snippet candidates; tap to insert
- Quick row: نیم‌فاصله، ، ؛ ؟ «» . and Persian digit pad
- Snippets (`;امضا` / `؛امضا` + space) editable; legal templates sheet
- Voice: big mic, live waveform, timer; engines: on-device Whisper tiny-fa / small-fa (self-hosted, offline after one download), Web Speech (detected), cloud Whisper (own key + base URL)
- Ported HarfCore cleanup applied to voice output
- Copy / Share / New; learns only from text you copy/share/save (pause anytime)
- History with search (Jalali dates); Memory screen (view/search/edit/delete/block/unblock/add, pause learning, export/import, reset)
- Settings: theme, font size, digits, cleanup toggles, engine, voice language, auto-copy after voice, full backup/restore, wipe
- Persian onboarding incl. Back Tap → Shortcuts “Open URLs”
- Privacy: no network calls besides same-origin files (and the opt-in cloud engine); no analytics

## Layout
`js/core/*` = 1:1 port of Swift HarfCore (tests in `tests/core.test.js`). `js/whisper-worker.js` runs transformers.js in a Worker.
`models/` is **not** in the source tarball — run `scripts/fetch-models.sh` (≈423 MB) before deploying.

## Dev
```
npm test                                   # 37 unit tests (node --test)
python3 -m http.server 8812 &              # serve
PW_DIR=/tmp/pw node tests/e2e.mjs http://127.0.0.1:8812/
PW_DIR=/tmp/pw node tests/whisper-smoke.mjs http://127.0.0.1:8812/ sample.wav whisper-tiny-fa
node scripts/icons.mjs                     # regenerate icons
```
Bump `VERSION` in `sw.js` on every deploy.
