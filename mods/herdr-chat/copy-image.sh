#!/bin/sh
# Copies an SVG to the clipboard as a picture (diagram-copy.js), on Linux and macOS: drawn at twice its size by whichever
# renderer is there (rsvg-convert, ImageMagick, Inkscape; Quick Look on macOS), then copied as PNG.
# Arguments: the SVG, where to write the PNG, its width and height in px. Exit 3: no renderer; 4: nothing drawn; 5: no clipboard tool.
svg=$1 png=$2 w=$(($3 * 2)) h=$(($4 * 2))
rm -f "$png"
if command -v rsvg-convert >/dev/null 2>&1; then rsvg-convert -w "$w" -h "$h" -o "$png" "$svg"
elif command -v magick >/dev/null 2>&1; then magick -density 192 -background none "$svg" "$png"
elif command -v convert >/dev/null 2>&1; then convert -density 192 -background none "$svg" "$png"
elif command -v inkscape >/dev/null 2>&1; then inkscape "$svg" --export-type=png --export-filename="$png" -w "$w" -h "$h" >/dev/null 2>&1
elif command -v qlmanage >/dev/null 2>&1; then
  dir=$(dirname "$png"); qlmanage -t -s "$w" -o "$dir" "$svg" >/dev/null 2>&1 && mv "$dir/$(basename "$svg").png" "$png"
else exit 3
fi
[ -s "$png" ] || exit 4
if [ "$(uname -s)" = Darwin ]; then osascript -e "set the clipboard to (read (POSIX file \"$png\") as «class PNGf»)"
elif [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null 2>&1; then wl-copy --type image/png < "$png"
elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -t image/png -i "$png"
elif command -v wl-copy >/dev/null 2>&1; then wl-copy --type image/png < "$png"
else exit 5
fi
