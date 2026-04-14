"""
LoRA Merge + GGUF Export
=========================
Usage (RunPod):
  # Step 1: SFT 머지
  python scripts/merge_and_export.py --stage sft-merge --adapter /workspace/training/sft-output/lora-adapters --output /workspace/training/sft-merged

  # Step 2: DPO 머지 (SFT 머지 위에)
  python scripts/merge_and_export.py --stage dpo-merge --base /workspace/training/sft-merged --adapter /workspace/training/dpo-output/dpo-adapters --output /workspace/training/final-merged

  # Step 3: GGUF 변환
  python scripts/merge_and_export.py --stage gguf --model /workspace/training/final-merged --output /workspace/training/gguf

  # Step 4: Ollama 등록
  python scripts/merge_and_export.py --stage ollama --gguf /workspace/training/gguf/ad-creative-agent-q4km.gguf
"""

import argparse
import subprocess
import os
from pathlib import Path

def sft_merge(adapter_path: str, output_path: str):
    print("=== Merging SFT LoRA into base model ===")
    from unsloth import FastLanguageModel
    import torch

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="unsloth/Qwen3-8B",
        max_seq_length=2048,
        load_in_4bit=True,
    )
    model.load_adapter(adapter_path)
    model.save_pretrained_merged(output_path, tokenizer, save_method="merged_16bit")
    print(f"  Merged model saved to {output_path}")

def dpo_merge(base_path: str, adapter_path: str, output_path: str):
    print("=== Merging DPO LoRA into SFT model ===")
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    model = AutoModelForCausalLM.from_pretrained(base_path, torch_dtype=torch.float16)
    tokenizer = AutoTokenizer.from_pretrained(base_path)
    model = PeftModel.from_pretrained(model, adapter_path)
    merged = model.merge_and_unload()
    merged.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)
    print(f"  Merged model saved to {output_path}")

def convert_gguf(model_path: str, output_dir: str):
    print("=== Converting to GGUF ===")
    os.makedirs(output_dir, exist_ok=True)

    llama_cpp = Path("/workspace/llama.cpp")
    if not llama_cpp.exists():
        print("  Cloning llama.cpp...")
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", str(llama_cpp)], check=True)
        subprocess.run(["make", "-C", str(llama_cpp), "-j", "quantize"], check=True)

    bf16_path = f"{output_dir}/ad-creative-agent-bf16.gguf"
    q4km_path = f"{output_dir}/ad-creative-agent-q4km.gguf"

    print("  Converting to GGUF (bf16)...")
    subprocess.run([
        "python3", str(llama_cpp / "convert_hf_to_gguf.py"),
        model_path,
        "--outtype", "bf16",
        "--outfile", bf16_path,
    ], check=True)

    print("  Quantizing to Q4_K_M...")
    subprocess.run([
        str(llama_cpp / "llama-quantize"),
        bf16_path, q4km_path, "Q4_K_M",
    ], check=True)

    # bf16 삭제 (용량 절약)
    os.remove(bf16_path)
    print(f"  GGUF saved to {q4km_path}")

def register_ollama(gguf_path: str):
    print("=== Registering with Ollama ===")
    modelfile_content = f'''FROM {gguf_path}

SYSTEM """You are an expert marketing creative director and AI image prompt engineer.
You create detailed video content plans and SDXL-optimized image generation prompts
for advertising campaigns. Your outputs are professional, actionable, and technically precise."""

TEMPLATE """{{{{ if .System }}}}<|im_start|>system
{{{{ .System }}}}<|im_end|>
{{{{ end }}}}{{{{ if .Prompt }}}}<|im_start|>user
{{{{ .Prompt }}}}<|im_end|>
{{{{ end }}}}<|im_start|>assistant
{{{{ .Response }}}}<|im_end|>"""

PARAMETER num_predict 4096
PARAMETER temperature 0.4
PARAMETER top_k 40
PARAMETER top_p 0.9
PARAMETER stop "<|im_end|>"
'''

    modelfile_path = "/tmp/Modelfile-ad-creative"
    with open(modelfile_path, "w") as f:
        f.write(modelfile_content)

    subprocess.run(["ollama", "create", "ad-creative-agent", "-f", modelfile_path], check=True)
    print("  Model registered as 'ad-creative-agent'")
    print("  Test with: ollama run ad-creative-agent")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, choices=["sft-merge", "dpo-merge", "gguf", "ollama"])
    parser.add_argument("--adapter", help="LoRA adapter path")
    parser.add_argument("--base", help="Base model path (for DPO merge)")
    parser.add_argument("--model", help="Merged model path (for GGUF)")
    parser.add_argument("--output", help="Output path")
    parser.add_argument("--gguf", help="GGUF file path (for Ollama)")
    args = parser.parse_args()

    if args.stage == "sft-merge":
        sft_merge(args.adapter, args.output)
    elif args.stage == "dpo-merge":
        dpo_merge(args.base, args.adapter, args.output)
    elif args.stage == "gguf":
        convert_gguf(args.model, args.output)
    elif args.stage == "ollama":
        register_ollama(args.gguf)

if __name__ == "__main__":
    main()
