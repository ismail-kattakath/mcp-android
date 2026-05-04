# mcp-android — combined ADB + scrcpy-vision MCP server
# Provides 37 tools for Android device control, screen streaming, and UI automation.
#
# Build:
#   docker build -t mcp-android .
#
# Run (USB-connected device):
#   docker run --rm -i \
#     --privileged \
#     -v /dev/bus/usb:/dev/bus/usb \
#     -v /path/to/scrcpy-server:/opt/scrcpy-server:ro \
#     -e SCRCPY_SERVER_PATH=/opt/scrcpy-server \
#     -e SCRCPY_SERVER_VERSION=3.2 \
#     mcp-android
#
# Run (WiFi ADB, no USB needed):
#   docker run --rm -i \
#     --network host \
#     -v /path/to/scrcpy-server:/opt/scrcpy-server:ro \
#     -e SCRCPY_SERVER_PATH=/opt/scrcpy-server \
#     -e SCRCPY_SERVER_VERSION=3.2 \
#     mcp-android
#
# Run (snapshot/ADB-only mode, no scrcpy):
#   docker run --rm -i \
#     --privileged \
#     -v /dev/bus/usb:/dev/bus/usb \
#     mcp-android

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine

# ADB (from android-tools package) + ffmpeg (for H.264 decoding in scrcpy streaming)
RUN apk add --no-cache android-tools ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

# Optional scrcpy-server binary mount point
RUN mkdir -p /opt/scrcpy

# Icon embedded as OCI label so docker mcp catalog can display it
COPY icon.png /opt/icon.png

ENV ADB_PATH=adb \
    FFMPEG_PATH=ffmpeg \
    SCRCPY_SERVER_PATH="" \
    SCRCPY_SERVER_VERSION="" \
    DEFAULT_MAX_SIZE=1024 \
    DEFAULT_MAX_FPS=30 \
    DEFAULT_FRAME_FPS=2 \
    SCRCPY_SOCKET_PREFIX=scrcpy \
    LOG_LEVEL=2 \
    ADB_SERVER_HOST="" \
    ADB_SERVER_PORT=""

LABEL org.opencontainers.image.title="Android Device Control" \
      org.opencontainers.image.description="Comprehensive Android device control — ADB + scrcpy vision + fast input. 37 tools." \
      com.docker.desktop.mcp.server.name="mcp-android" \
      com.docker.desktop.mcp.server.title="Android Device Control" \
      com.docker.desktop.mcp.server.description="Comprehensive Android device control — ADB, scrcpy H.264 streaming, fast input, APK install, logcat, Activity/Package Manager. 37 tools."

ENTRYPOINT ["node", "dist/index.js"]
