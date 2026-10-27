# Voice engine research (Oct 2026)

## Benchmark — 15 clips (5 Persian legal sentences × 3 Piper TTS voices), Node + onnxruntime CPU, transformers.js 3.8.1
| model | dtype enc/dec | download | WER | CER | avg time |
|---|---|---|---|---|---|
| whisper-base (generic) | q8 | — | 1.20 | 0.96 | broken |
| whisper-base (generic) | fp32 | ~290 MB | 0.87 | 0.33 | — |
| whisper-base (generic) | fp32/q4 | — | 0.84 | 0.33 | 607 ms |
| whisper-small (generic) | q4 | — | 0.68 | 0.235 | — |
| armantee/whisper-base-persian-onnx | fp32/q8 | — | 0.46 | 0.30 | — |
| **onnx-community/whisper-tiny-fa-ONNX** | q4/q4 | **108 MB** | 0.45 | 0.18 | 361 ms |
| **onnx-community/whisper-small-fa-ONNX** | q4/q4 | **312 MB** | **0.32** | **0.106** | 1114 ms |

Synthetic TTS speech is cleaner than a real voice in a courtroom corridor — treat numbers as a ranking, not absolute accuracy.
Generic multilingual Whisper at tiny/base size is unusable for Persian (hallucination loops); the Persian fine-tunes are dramatically better.

## In-browser (headless Chrome, WASM, 1 thread — GitHub Pages has no COOP/COEP so no SharedArrayBuffer threads)
See `tests/whisper-smoke.mjs`. whisper-tiny-fa on clip s1_gyro (ref: «سلام وقت شما بخیر جلسه دادگاه فردا ساعت ده صبح برگزار می‌شود»):
model load ≈1.3 s, first transcription ≈5.4 s, warm ≈3.7 s → «سلام وقت شما به خرجالسهای دادگاه آفردا ساعات دحسو بر گزار می شود.»
whisper-small-fa same clip: load ≈2.2 s, ≈24–26 s per transcription → «سلام وقت شما به فری جلسهی دادگاه فردا ساعت، دهصبح برگزار میشود.» (more accurate, ~6× slower).
iPhone WASM is typically 1.5–3× slower than desktop; tiny-fa should stay well under iOS Safari's per-tab memory limit; small-fa (~312 MB weights, >1 GB RAM at runtime) may be killed on older iPhones → marked experimental.

## Engines in the app
1. **On-device Whisper (default: tiny-fa «سبک»; optional small-fa «دقیق»)** — models self-hosted next to the app (no Hugging Face, which is unreliable from Iran), each file < 95 MB (decoder split into .partNN + .parts.json), downloaded once with progress into Cache Storage `harf-models-v1`, offline afterwards.
2. **Web Speech API** — detected at runtime. On iOS Safari it routes to Apple's server-side dictation; Persian (fa-IR) is not an Apple dictation language, so expect `language-not-supported` / empty results — UI says so honestly. Good for English.
3. **Cloud Whisper (opt-in)** — OpenAI-compatible `/audio/transcriptions`; presets Groq (`whisper-large-v3`) and OpenAI (`whisper-1`). Key stored only in localStorage, never exported in backups. Needs unfiltered internet from Iran.

All engine output passes through the ported HarfCore cleanup (fillers, repeats, spoken punctuation, Arabic→Persian letters, ZWNJ, optional Persian digits) before insertion at the cursor.
