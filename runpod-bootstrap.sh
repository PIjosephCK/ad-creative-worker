#!/bin/bash
# =============================================================
# RunPod Bootstrap Script for Ad Creative Worker
# Pod 재생성 시 이 스크립트 하나로 전체 환경 복구
# 사용법: bash /workspace/ad-creative-worker/runpod-bootstrap.sh
# =============================================================
set -e

echo "=========================================="
echo "  Ad Creative Worker — RunPod Bootstrap"
echo "=========================================="

MODEL_DIR="/workspace/models"
WORKER_DIR="/workspace/ad-creative-worker"
COMFYUI_DIR="/opt/comfyui"

# --- [1/6] Node.js ---
if ! command -v node &>/dev/null; then
  echo "[1/6] Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
else
  echo "[1/6] Node.js already installed ($(node -v))"
fi

# --- [2/6] Ollama ---
if ! command -v ollama &>/dev/null; then
  echo "[2/6] Installing Ollama..."
  apt-get update -qq && apt-get install -y -qq zstd pciutils >/dev/null 2>&1
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "[2/6] Ollama already installed"
fi

# --- [3/6] ComfyUI ---
if [ ! -d "$COMFYUI_DIR" ]; then
  echo "[3/6] Installing ComfyUI..."
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
  cd "$COMFYUI_DIR" && pip3 install -q -r requirements.txt
  # Custom nodes
  cd "$COMFYUI_DIR/custom_nodes"
  git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus.git
  git clone --depth 1 https://github.com/ZHO-ZHO-ZHO/ComfyUI-BRIA_AI-RMBG.git
  git clone --depth 1 https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git
else
  echo "[3/6] ComfyUI already installed"
fi

# --- [4/6] ComfyUI model paths ---
echo "[4/6] Configuring model paths..."
python3 -c "
import yaml
data = {'workspace': {
    'base_path': '/workspace/models/comfyui',
    'checkpoints': 'checkpoints',
    'clip': 'clip',
    'clip_vision': 'clip_vision',
    'ipadapter': 'ipadapter',
    'vae': 'vae',
    'unet': 'unet'
}}
with open('$COMFYUI_DIR/extra_model_paths.yaml', 'w') as f:
    yaml.dump(data, f, default_flow_style=False)
"
mkdir -p "$COMFYUI_DIR/models/ipadapter" "$MODEL_DIR/comfyui/clip_vision" "$MODEL_DIR/comfyui/unet"
ln -sf "$MODEL_DIR/comfyui/ipadapter"/*.safetensors "$COMFYUI_DIR/models/ipadapter/" 2>/dev/null || true

# --- [5/6] Worker dependencies ---
echo "[5/6] Setting up worker..."
cd "$WORKER_DIR"
npm install --silent 2>/dev/null
npx prisma generate 2>/dev/null
npx prisma db push --accept-data-loss 2>/dev/null || true
mkdir -p data output output/videos

# FFmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo "  Installing ffmpeg..."
  apt-get install -y -qq ffmpeg >/dev/null 2>&1
fi

# AnimateDiff motion model
if [ ! -f "$COMFYUI_DIR/models/animatediff_models/mm_sdxl_v10_beta.ckpt" ]; then
  echo "  Downloading AnimateDiff SDXL motion model..."
  mkdir -p "$COMFYUI_DIR/models/animatediff_models"
  wget -q -O "$COMFYUI_DIR/models/animatediff_models/mm_sdxl_v10_beta.ckpt" \
    "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sdxl_v10_beta.ckpt" || true
fi

# --- [6/6] Start all services ---
echo "[6/6] Starting services..."

# Ollama
export OLLAMA_MODELS="$MODEL_DIR/ollama"
ollama serve &
OLLAMA_PID=$!
sleep 3

# ComfyUI
cd "$COMFYUI_DIR" && python3 main.py --listen 0.0.0.0 --port 8888 &
COMFYUI_PID=$!

# Wait for ComfyUI
echo "  Waiting for ComfyUI..."
for i in $(seq 1 60); do
  if curl -s http://localhost:8888/system_stats >/dev/null 2>&1; then
    echo "  ComfyUI ready!"
    break
  fi
  sleep 2
done

# Worker
cd "$WORKER_DIR" && npx tsx src/server.ts &
WORKER_PID=$!

echo ""
echo "=========================================="
echo "  All services running!"
echo "  Worker:  http://0.0.0.0:3000"
echo "  ComfyUI: http://0.0.0.0:8888"
echo "  Ollama:  http://0.0.0.0:11434"
echo "=========================================="

# Keep alive
wait -n $OLLAMA_PID $COMFYUI_PID $WORKER_PID
echo "A process exited, shutting down..."
kill $OLLAMA_PID $COMFYUI_PID $WORKER_PID 2>/dev/null
