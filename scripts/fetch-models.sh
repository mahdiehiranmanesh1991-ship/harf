#!/usr/bin/env bash
# Downloads the two Persian Whisper fine-tunes (q4 ONNX, Apache-2.0) from Hugging Face into models/,
# splitting any file > 95 MB into .partNN chunks + .parts.json (GitHub Pages limit 100 MB/file).
# Run once on a machine with HF access, then commit models/ (Git LFS not needed).
set -euo pipefail
cd "$(dirname "$0")/.."
HF=${HF_ENDPOINT:-https://huggingface.co}
FILES="config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json onnx/encoder_model_q4.onnx onnx/decoder_model_merged_q4.onnx"
for pair in "whisper-tiny-fa:onnx-community/whisper-tiny-fa-ONNX:60" "whisper-small-fa:onnx-community/whisper-small-fa-ONNX:90"; do
  IFS=: read -r id repo chunk <<<"$pair"; mkdir -p "models/$id/onnx"
  for f in $FILES; do
    out="models/$id/$f"; [ -s "$out" ] || [ -s "$out.parts.json" ] && continue
    echo "↓ $repo/$f"; curl -fL --retry 3 -o "$out" "$HF/$repo/resolve/main/$f"
    size=$(stat -c %s "$out")
    if [ "$size" -gt $((95*1024*1024)) ]; then
      split -b "${chunk}M" -d -a 2 "$out" "$out.part"
      parts=$(ls "$out".part?? | xargs -n1 basename | sed 's/.*/"&"/' | paste -sd, -)
      echo "{\"size\": $size, \"parts\": [$parts]}" > "$out.parts.json"; rm "$out"
    fi
  done
done
( cd models && find . -type f | sort | xargs sha256sum > SHA256SUMS ) && echo "✓ models ready ($(du -sh models | cut -f1))"
