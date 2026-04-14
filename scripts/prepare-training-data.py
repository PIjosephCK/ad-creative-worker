"""
Training Data Preparation Script
=================================
1. 한영 혼합 데이터를 영어로 통일
2. Qwen3 messages 포맷으로 변환
3. SFT + DPO 출력 파일 생성

Usage:
  python scripts/prepare-training-data.py --input-dir C:/Users/qordi/Downloads/prompt --output-dir ./training-data

  # 번역 없이 포맷 변환만 (테스트용)
  python scripts/prepare-training-data.py --input-dir C:/Users/qordi/Downloads/prompt --output-dir ./training-data --no-translate
"""

import json
import re
import sys
import os
from pathlib import Path

# ========== Config ==========

MARKETING_SFT_FILE = "EN_marketing_finetuning_5000.jsonl"
REFINER_SFT_FILE = "EN_prompt_refiner_SFT_5000.jsonl"
REFINER_DPO_FILE = "EN_prompt_refiner_DPO_3000.jsonl"

SYSTEM_PROMPT_PLANNER = (
    "You are an expert marketing creative director specializing in short-form video advertising. "
    "Given a marketing brief, you create detailed video content plans with storyboards, "
    "camera directions, text overlays, and performance KPIs. "
    "Your plans are professional, actionable, and optimized for social media platforms."
)

SYSTEM_PROMPT_REFINER = (
    "You are an expert AI image generation prompt engineer specializing in SDXL. "
    "Given a marketing brief or concept description, you create highly detailed, "
    "technically precise image generation prompts including camera settings, lighting, "
    "composition, color palette, and style references. "
    "Your prompts consistently produce professional advertising-quality images."
)

# ========== Korean Detection ==========

def has_korean(text: str) -> bool:
    return bool(re.search('[가-힣]', text))

def translate_korean_segments(text: str) -> str:
    """
    한국어 세그먼트를 영어로 치환.
    자주 나오는 패턴을 사전 기반으로 처리.
    """
    # Common Korean phrases in the dataset
    translations = {
        # Instructions
        "아래 정보를 기반으로": "Based on the information below,",
        "바이럴 가능성 높은": "with high viral potential",
        "숏폼 영상 콘텐츠를 설계해줘": "design short-form video content",
        "숏폼 영상 콘텐츠의 스토리보드와 스크립트를 제안해줘": "suggest a storyboard and script for short-form video content",
        "주어진 조건에 맞는": "matching the given conditions,",
        "다음 마케팅 요구사항에 맞는": "matching the following marketing requirements,",
        "SDXL 최적화 프롬프트를 생성해줘": "generate an SDXL-optimized prompt",
        "매칭": "matching",
        "작성해줘": "write it",
        "만들어줘": "create it",
        "제안해줘": "suggest",
        "설계해줘": "design it",
        "생성해줘": "generate",

        # Input fields
        "1인칭 시점": "first-person perspective",
        "시즌 무관": "all seasons",
        "겨울": "winter",
        "여름": "summer",
        "봄": "spring",
        "가을": "autumn",
        "신년": "New Year",

        # Output sections
        "숏폼 영상 기획안": "Short-form Video Plan",
        "콘셉트 개요": "Concept Overview",
        "핵심 메시지": "Key Message",
        "영상 길이": "Video Length",
        "후킹 전략": "Hook Strategy",
        "트렌지션 효과 활용": "Transition effect utilization",
        "스토리보드": "Storyboard",
        "화면": "Visual",
        "텍스트 오버레이": "Text Overlay",
        "카메라워크": "Camera Work",
        "임팩트 있는 오프닝": "Impactful opening",
        "시네마틱 핸드헬드": "Cinematic handheld",
        "제품 다각도": "Multi-angle product shot",
        "인서트 컷": "insert cuts",
        "라이프스타일 컷": "Lifestyle cuts",
        "데이터 시각화": "Data visualization",
        "리뷰 모션": "review motion",
        "텍스트 모션그래픽": "Text motion graphics",
        "엔드카드": "End card",
        "영상 생성 프롬프트": "Video Generation Prompt",
        "연출 가이드": "Direction Guide",
        "트렌지션": "Transitions",
        "줌 트렌지션": "Zoom transition",
        "페이드 인/아웃": "fade in/out",
        "매치컷": "Match cut",
        "배경음악": "Background Music",
        "자막 스타일": "Subtitle Style",
        "컬러 그레이딩": "Color Grading",
        "게시 전략": "Publishing Strategy",
        "게시 시간": "Posting Time",
        "성과 측정 KPI": "Performance KPI",
        "조회수 목표": "View count target",
        "참여율 목표": "Engagement rate target",
        "핵심 지표": "Key metrics",
        "3초 시청률": "3-second view rate",
        "영상 완주율": "Video completion rate",
        "릴스 평균 대비": "compared to Reels average",
        "고객 만족도": "Customer satisfaction",
        "한정 특별 혜택": "limited special offer",
        "지금 신청하기": "Apply now",
        "팔로우하고 소식 받기": "Follow and get updates",
        "끝까지 보면 후회 안 해요": "You won't regret watching till the end",
        "솔직히 이거 너무 불편했잖아": "Honestly, this was so inconvenient",
        "직접 써보니까 진짜 다르더라": "It really is different when you try it yourself",
        "의 일상에서 발생하는 문제 상황 스토리텔링": "'s daily life problem storytelling",
        "등장 및 상세 소개": "introduction and detailed presentation",
        "차별점 3가지를 순차적으로 보여줌": "showing 3 differentiators sequentially",
        "실제 사용 장면을 자연스럽게 연출": "Natural demonstration of actual usage",
        "무드 유지": "maintaining mood",
        "고객 리뷰, 수상 이력, 판매량 등 신뢰 요소": "Trust elements: customer reviews, awards, sales figures",
        "현재 진행 중인 이벤트나 할인 정보": "Current events or discount information",
        "최종 행동 유도 + 브랜드 슬로건 + 로고": "Final CTA + brand slogan + logo",
        "의 새로운 매력을 발견하세요": "Discover the new charm of",
        "로 달라지는 일상": "life transformed by",
        "굵은 산세리프": "Bold sans-serif",
        "깔끔한 산세리프": "Clean sans-serif",
        "화면 중앙": "center screen",
        "하단 3분의 1": "lower third",
        "키워드 컬러 강조": "keyword color emphasis",
        "화이트 + 드롭섀도우": "white + drop shadow",
        "쿨톤 보정": "Cool tone correction",
        "소프트 필터": "Soft filter",
        "빈티지": "vintage",
        "감성 어쿠스틱": "Emotional acoustic",
        "미니멀 앰비언트": "Minimal ambient",
        "무드에 맞는": "matching the mood",
        "오전": "AM",
        "오후": "PM",
        "저녁": "evening",
        "좋아요+댓글+저장 기준": "based on likes+comments+saves",
        "이상": "or more",

        # Tone/manner
        "감성적/무드있는": "emotional/moody",
        "따뜻한/정감있는": "warm/heartfelt",
        "트렌디/힙한": "trendy/hip",
        "프로페셔널/신뢰감": "professional/trustworthy",
        "유머러스/재미있는": "humorous/fun",
        "럭셔리/프리미엄": "luxury/premium",
        "캐주얼/친근한": "casual/friendly",
        "드라마틱": "dramatic",
        "에너제틱/활동적": "energetic/active",
        "미니멀/깔끔한": "minimal/clean",

        # Common fragments
        "에 맞는 BPM": "at BPM",
        "첫째, ... 둘째, ... 셋째, ...": "First, ... Second, ... Third, ...",
    }

    result = text
    # Sort by length descending to match longer phrases first
    for ko, en in sorted(translations.items(), key=lambda x: len(x[0]), reverse=True):
        result = result.replace(ko, en)

    return result


def clean_text(text: str, translate: bool = True) -> str:
    """텍스트 정리 + 한국어 번역"""
    if translate and has_korean(text):
        text = translate_korean_segments(text)

    # 남은 한국어 문자 제거 (사전에 없는 것들)
    if translate:
        # 한국어 단어를 [ko] 마커로 표시하지 않고 그냥 제거
        text = re.sub(r'[가-힣]+', '', text)

    # 다중 공백 정리
    text = re.sub(r'  +', ' ', text)
    text = re.sub(r'\n\n\n+', '\n\n', text)
    return text.strip()


# ========== Format Conversion ==========

def convert_sft_to_messages(entry: dict, system_prompt: str, translate: bool = True) -> dict:
    """instruction/input/output → Qwen3 messages format"""
    instruction = clean_text(entry["instruction"], translate)
    input_text = clean_text(entry["input"], translate)
    output_text = clean_text(entry["output"], translate)

    user_content = f"{instruction}\n\n{input_text}" if input_text else instruction

    return {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": output_text},
        ]
    }


def convert_dpo_entry(entry: dict, translate: bool = True) -> dict:
    """prompt/chosen/rejected → 정리된 DPO format"""
    prompt = clean_text(entry["prompt"], translate)
    chosen = clean_text(entry["chosen"], translate)
    rejected = clean_text(entry["rejected"], translate)

    return {
        "prompt": prompt,
        "chosen": chosen,
        "rejected": rejected,
    }


# ========== Main ==========

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Prepare training data for Qwen3 fine-tuning")
    parser.add_argument("--input-dir", required=True, help="Directory containing source JSONL files")
    parser.add_argument("--output-dir", default="./training-data", help="Output directory")
    parser.add_argument("--no-translate", action="store_true", help="Skip Korean→English translation")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    translate = not args.no_translate

    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Translate Korean: {translate}")
    print()

    # 1. Marketing SFT
    print("=== Processing Marketing SFT ===")
    marketing_path = input_dir / MARKETING_SFT_FILE
    marketing_out = []
    with open(marketing_path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            entry = json.loads(line)
            converted = convert_sft_to_messages(entry, SYSTEM_PROMPT_PLANNER, translate)
            marketing_out.append(converted)
    print(f"  Converted: {len(marketing_out)} entries")

    # 2. Refiner SFT
    print("=== Processing Refiner SFT ===")
    refiner_path = input_dir / REFINER_SFT_FILE
    refiner_out = []
    with open(refiner_path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            entry = json.loads(line)
            converted = convert_sft_to_messages(entry, SYSTEM_PROMPT_REFINER, translate)
            refiner_out.append(converted)
    print(f"  Converted: {len(refiner_out)} entries")

    # 3. Combined SFT output
    sft_combined = marketing_out + refiner_out
    sft_output_path = output_dir / "train_sft.jsonl"
    with open(sft_output_path, "w", encoding="utf-8") as f:
        for entry in sft_combined:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"\n  Combined SFT: {len(sft_combined)} entries → {sft_output_path}")

    # Also save separate files
    with open(output_dir / "train_sft_planner.jsonl", "w", encoding="utf-8") as f:
        for entry in marketing_out:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    with open(output_dir / "train_sft_refiner.jsonl", "w", encoding="utf-8") as f:
        for entry in refiner_out:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # 4. DPO
    print("=== Processing DPO ===")
    dpo_path = input_dir / REFINER_DPO_FILE
    dpo_out = []
    with open(dpo_path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            entry = json.loads(line)
            converted = convert_dpo_entry(entry, translate)
            dpo_out.append(converted)

    dpo_output_path = output_dir / "train_dpo.jsonl"
    with open(dpo_output_path, "w", encoding="utf-8") as f:
        for entry in dpo_out:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"  Converted: {len(dpo_out)} entries → {dpo_output_path}")

    # 5. Stats
    print("\n=== Summary ===")
    print(f"  SFT (planner):  {len(marketing_out)} entries")
    print(f"  SFT (refiner):  {len(refiner_out)} entries")
    print(f"  SFT (combined): {len(sft_combined)} entries")
    print(f"  DPO:            {len(dpo_out)} entries")
    print(f"  Total:          {len(sft_combined) + len(dpo_out)} entries")

    # 6. Verify Korean removal
    if translate:
        print("\n=== Korean Removal Check ===")
        remaining_korean = 0
        for entry in sft_combined[:100]:
            for msg in entry["messages"]:
                if has_korean(msg["content"]):
                    remaining_korean += 1
        for entry in dpo_out[:100]:
            for v in entry.values():
                if isinstance(v, str) and has_korean(v):
                    remaining_korean += 1
        print(f"  Korean remaining in first 100 samples: {remaining_korean}")

    print(f"\nOutput files:")
    for p in sorted(output_dir.iterdir()):
        size_mb = p.stat().st_size / (1024 * 1024)
        print(f"  {p.name}: {size_mb:.1f}MB")


if __name__ == "__main__":
    main()
