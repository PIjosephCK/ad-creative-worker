"""
Qwen3-8B DPO Training (on top of SFT)
=======================================
Usage (RunPod):
  python scripts/train_dpo.py --sft-model /workspace/training/sft-merged --data /workspace/training/train_dpo.jsonl --output /workspace/training/dpo-output
"""

import argparse
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig
from trl import DPOTrainer, DPOConfig
from datasets import load_dataset
import torch

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sft-model", default="/workspace/training/sft-merged", help="Path to SFT-merged model")
    parser.add_argument("--data", default="/workspace/training/train_dpo.jsonl")
    parser.add_argument("--output", default="/workspace/training/dpo-output")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--lr", type=float, default=1e-4)
    args = parser.parse_args()

    print("=== Loading SFT-trained model ===")
    model = AutoModelForCausalLM.from_pretrained(
        args.sft_model,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        load_in_4bit=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.sft_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("=== Loading DPO dataset ===")
    dataset = load_dataset("json", data_files=args.data, split="train")
    print(f"  Dataset size: {len(dataset)}")

    print("=== Configuring DPO ===")
    peft_config = LoraConfig(
        r=16,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "up_proj", "down_proj", "gate_proj"],
    )

    dpo_config = DPOConfig(
        output_dir=args.output,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        optim="adamw_8bit",
        max_prompt_length=512,
        max_length=1536,
        bf16=True,
        logging_steps=10,
        save_steps=200,
        save_total_limit=2,
        report_to="none",
        seed=42,
    )

    print("=== Starting DPO training ===")
    trainer = DPOTrainer(
        model=model,
        args=dpo_config,
        train_dataset=dataset,
        tokenizer=tokenizer,
        peft_config=peft_config,
    )

    trainer.train()

    print("=== Saving DPO adapters ===")
    model.save_pretrained(f"{args.output}/dpo-adapters")
    tokenizer.save_pretrained(f"{args.output}/dpo-adapters")
    print(f"  Saved to {args.output}/dpo-adapters")
    print("=== DPO training complete! ===")

if __name__ == "__main__":
    main()
