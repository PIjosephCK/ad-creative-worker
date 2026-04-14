FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# System dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    nodejs npm \
    git curl wget \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Install ComfyUI
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /opt/comfyui \
    && cd /opt/comfyui \
    && pip3 install -r requirements.txt \
    && pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install ComfyUI custom nodes
RUN cd /opt/comfyui/custom_nodes \
    && git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git \
    && git clone https://github.com/BRIA-AI/ComfyUI-BRIA-RMBG.git \
    && cd ComfyUI_IPAdapter_plus && pip3 install -r requirements.txt || true \
    && cd ../ComfyUI-BRIA-RMBG && pip3 install -r requirements.txt || true

# Copy worker app
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .
RUN npx prisma generate
RUN npx tsc

# Create directories
RUN mkdir -p /app/output/images /app/output/training-data /app/data

# Startup script
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 3000 8188 11434

CMD ["/start.sh"]
