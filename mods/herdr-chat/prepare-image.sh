#!/bin/sh
# Copies an image into the chat's preview folder, ready to attach, and prints its path.
# Claude Code attaches an @-mentioned image only up to about 256 KB, so a bigger one is
# re-encoded as a JPEG under 240 KB (ImageMagick, or sips on macOS).
#   prepare-image.sh <image> <folder> <name without extension>
# Exit 5: it's too big and nothing here can shrink it (the copy is made anyway).
src=$1 dir=$2 base=$3
mkdir -p "$dir" || exit 1
limit=250000
size=$(wc -c < "$src") || exit 1
ext=$(printf '%s' "$src" | sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' | tr 'A-Z' 'a-z')
[ -n "$ext" ] || ext=png
if [ "$size" -le "$limit" ]; then
  cp -- "$src" "$dir/$base.$ext" || exit 1
  printf '%s\n' "$dir/$base.$ext"
  exit 0
fi
out="$dir/$base.jpg"
if command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; then
  im=magick; command -v magick >/dev/null 2>&1 || im=convert
  "$im" "$src[0]" -auto-orient -resize '2000x2000>' -background white -alpha remove -alpha off \
    -strip -quality 85 -define jpeg:extent=240KB "$out" || exit 1
elif command -v sips >/dev/null 2>&1; then
  quality=80
  sips -Z 2000 -s format jpeg -s formatOptions "$quality" "$src" --out "$out" >/dev/null || exit 1
  while [ "$(wc -c < "$out")" -gt "$limit" ] && [ "$quality" -gt 30 ]; do
    quality=$((quality - 15))
    sips -s format jpeg -s formatOptions "$quality" "$out" --out "$out" >/dev/null || exit 1
  done
else
  cp -- "$src" "$dir/$base.$ext" || exit 1
  printf '%s\n' "$dir/$base.$ext"
  exit 5
fi
printf '%s\n' "$out"
