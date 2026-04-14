"""
Qwen3-8B SFT Training (QLoRA)
==============================
Usage (RunPod):
  pip install unsloth trl datasets
  python scripts/train_sft.py --data /workspace/training/train_sft.jsonl --output /workspace/training/sft-output
"""

import argparse
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset
import torch

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="/workspace/training/train_sft.jsonl")
    parser.add_argument("--output", default="/workspace/training/sft-output")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--max-seq-len", type=int, default=2048)
    parser.add_argument("--lora-r", type=int, default=16)
    args = parser.parse_args()

    print("=== Loading Qwen3-8B (4-bit QLoRA) ===")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="unsloth/Qwen3-8B",
        max_seq_length=args.max_seq_len,
        dtype=torch.float16,
        load_in_4bit=True,
    )

    print("=== Adding LoRA adapters ===")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        lora_alpha=args.lora_r,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "up_proj", "down_proj", "gate_proj"],
    )

    print("=== Loading dataset ===")
    dataset = load_dataset("json", data_files=args.data, split="train")

    def format_messages(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
            enable_thinking=False,
        )
        return {"text": text}

    dataset = dataset.map(format_messages)
    print(f"  Dataset size: {len(dataset)}")
    print(f"  Sample: {dataset[0]['text'][:200]}...")

    print("=== Starting SFT training ===")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_len,
        args=TrainingArguments(
            output_dir=args.output,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            warmup_steps=100,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=10,
            save_steps=200,
            save_total_limit=3,
            optim="adamw_8bit",
            weight_decay=0.01,
            seed=42,
            report_to="none",
        ),
    )

    trainer.train()

    print("=== Saving LoRA adapters ===")
    model.save_pretrained(f"{args.output}/lora-adapters")
    tokenizer.save_pretrained(f"{args.output}/lora-adapters")
    print(f"  Saved to {args.output}/lora-adapters")
    print("=== SFT training complete! ===")

if __name__ == "__main__":
    main()
