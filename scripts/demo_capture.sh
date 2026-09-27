#!/usr/bin/env bash
# demo_capture.sh — capture harness for the CO-GRID demo video.
#   Xvfb :99 (1600x900) + chromium --kiosk on the app (CDP :9222)
#   + ffmpeg x11grab → /tmp/demo_capture.mp4
# The driver (record_demo.mjs) moves the real cursor via xdotool so the
# recording reads as a human session.
#
# Usage:
#   scripts/demo_capture.sh start    # bring up display+browser+grabber
#   scripts/demo_capture.sh stop     # stop grabber (finalizes mp4)
#   scripts/demo_capture.sh down     # tear down everything
set -u
DISP=:99
SIZE=1600x900x24
OUT=${1:-}
URL=http://127.0.0.1:3210
PIDDIR=/tmp/cogrid-demo-pids
mkdir -p "$PIDDIR"

start() {
  Xvfb "$DISP" -screen 0 "$SIZE" >/tmp/xvfb.log 2>&1 &
  echo $! > "$PIDDIR/xvfb.pid"
  sleep 1
  DISPLAY=$DISP /usr/bin/chromium \
    --remote-debugging-port=9222 \
    --user-data-dir=/tmp/cogrid-demo-profile \
    --no-first-run --no-default-browser-check \
    --disable-infobars --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    --ozone-platform=x11 \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
    --window-size=1600,900 --window-position=0,0 \
    --kiosk "$URL" >/tmp/chromium-demo.log 2>&1 &
  echo $! > "$PIDDIR/chromium.pid"
  sleep 6
  # bare Xvfb has no WM to enforce kiosk geometry — force the window to
  # fill the screen so the app renders its large-viewport layout
  # (SIZE is WxHxDEPTH — split off the color depth, don't eat it as height)
  local W="${SIZE%%x*}" H="${SIZE#*x}"; H="${H%%x*}"
  for w in $(DISPLAY=$DISP xdotool search --class chromium 2>/dev/null); do
    DISPLAY=$DISP xdotool windowsize "$w" "$W" "$H" windowmove "$w" 0 0 2>/dev/null
  done
  sleep 1
  ffmpeg -y -loglevel error -f x11grab -video_size "${SIZE%x*}" -framerate 30 \
    -i "$DISP" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    /tmp/demo_capture.mp4 >/tmp/ffmpeg-grab.log 2>&1 &
  echo $! > "$PIDDIR/ffmpeg.pid"
  echo "capturing → /tmp/demo_capture.mp4  (ctrl via record_demo.mjs)"
}

stop() {
  [ -f "$PIDDIR/ffmpeg.pid" ] && kill -INT "$(cat "$PIDDIR/ffmpeg.pid")" 2>/dev/null
  sleep 1
  ls -la /tmp/demo_capture.mp4 2>/dev/null
}

down() {
  stop
  for f in chromium xvfb; do
    [ -f "$PIDDIR/$f.pid" ] && kill "$(cat "$PIDDIR/$f.pid")" 2>/dev/null
  done
  rm -f "$PIDDIR"/*.pid
}

case "${OUT:-start}" in
  start) start ;;
  stop)  stop ;;
  down)  down ;;
  *) echo "usage: $0 start|stop|down" >&2; exit 2 ;;
esac
