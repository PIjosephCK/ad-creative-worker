#!/bin/bash
set -e

echo "=== Ad Creative Worker Starting ==="

# --- Model directory setup (RunPod Network Volume) ---
MODEL_DIR="${MODEL_DIR:-/workspace/models}"
mkdir -p "$MODEL_DIR/ollama" "$MODEL_DIR/comfyui/checkpoints" "$MODEL_DIR/comfyui/clip" \
         "$MODEL_DIR/comfyui/ipadapter" "$MODEL_DIR/comfyui/vae" "$MODEL_DIR/comfyui/rmbg"

# Symlink model directories to ComfyUI
ln -sf "$MODEL_DIR/comfyui/checkpoints" /opt/comfyui/models/checkpoints
ln -sf "$MODEL_DIR/comfyui/clip" /opt/comfyui/models/clip
ln -sf "$MODEL_DIR/comfyui/ipadapter" /opt/comfyui/models/ipadapter
ln -sf "$MODEL_DIR/comfyui/vae" /opt/comfyui/models/vae

# Ollama model directory
export OLLAMA_MODELS="$MODEL_DIR/ollama"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-0}"

# --- Start Ollama ---
echo "[1/4] Starting Ollama..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "  Ollama ready!"
    break
  fi
  sleep 1
done

# Pull models if not cached
echo "[2/4] Checking models..."
ollama pull "${OLLAMA_MODEL:-qwen3:8b}" 2>/dev/null || true
ollama pull "${OLLAMA_VL_MODEL:-minicpm-v}" 2>/dev/null || true

# --- Download ComfyUI models if not present ---
echo "[3/4] Checking ComfyUI models..."

# Juggernaut XL v10 (SDXL)
if [ ! -f "$MODEL_DIR/comfyui/checkpoints/juggernautXL_v10.safetensors" ]; then
  echo "  Downloading Juggernaut XL v10..."
  wget -q -O "$MODEL_DIR/comfyui/checkpoints/juggernautXL_v10.safetensors" \
    "https://huggingface.co/RunDiffusion/Juggernaut-X-v10/resolve/main/juggernautXL_v10.safetensors" || true
fi

# CLIP ViT-H (for IP-Adapter vision encoder)
if [ ! -f "$MODEL_DIR/comfyui/clip/clip-vit-h-14-laion2B-s32B-b79K.safetensors" ]; then
  echo "  Downloading CLIP ViT-H..."
  wget -q -O "$MODEL_DIR/comfyui/clip/clip-vit-h-14-laion2B-s32B-b79K.safetensors" \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" || true
fi

# IP-Adapter models
if [ ! -f "$MODEL_DIR/comfyui/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors" ]; then
  echo "  Downloading IP-Adapter Plus Face..."
  wget -q -O "$MODEL_DIR/comfyui/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors" \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors" || true
fi

if [ ! -f "$MODEL_DIR/comfyui/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
  echo "  Downloading IP-Adapter Plus..."
  wget -q -O "$MODEL_DIR/comfyui/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" || true
fi

# RMBG model
if [ ! -f "$MODEL_DIR/comfyui/rmbg/RMBG-2.0" ]; then
  echo "  Downloading RMBG-2.0..."
  pip3 install huggingface_hub
  python3 -c "from huggingface_hub import snapshot_download; snapshot_download('briaai/RMBG-2.0', local_dir='$MODEL_DIR/comfyui/rmbg/RMBG-2.0')" || true
fi

# --- Start ComfyUI ---
echo "[4/4] Starting ComfyUI..."
cd /opt/comfyui
python3 main.py --listen 0.0.0.0 --port 8188 --preview-method auto &
COMFYUI_PID=$!

# Wait for ComfyUI
for i in $(seq 1 60); do
  if curl -s http://localhost:8188/system_stats > /dev/null 2>&1; then
    echo "  ComfyUI ready!"
    break
  fi
  sleep 2
done

# --- Start Worker Server ---
echo "=== Starting Worker Server ==="
cd /app
npx prisma db push --accept-data-loss 2>/dev/null || true
node dist/server.js &
WORKER_PID=$!

echo "=== All services running ==="
echo "  Worker: http://0.0.0.0:3000"
echo "  ComfyUI: http://0.0.0.0:8188"
echo "  Ollama: http://0.0.0.0:11434"

# Wait for any process to exit
wait -n $OLLAMA_PID $COMFYUI_PID $WORKER_PID
echo "A process exited, shutting down..."
kill $OLLAMA_PID $COMFYUI_PID $WORKER_PID 2>/dev/null
