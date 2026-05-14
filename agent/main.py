import os
from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def build_prompt(theme: str, mood: str, camera: str, color_grade: str) -> str:
    fragments = {
        "theme": {
            "futuristic": "cinematic futuristic aesthetic, holographic overlays, neon-lit environment, sharp depth of field",
            "surreal": "dreamlike surreal imagery, impossible geometry, soft ethereal lighting, otherworldly atmosphere",
            "gritty": "raw gritty urban texture, harsh contrast, street-level realism, worn surfaces",
            "dreamlike": "soft pastel dreamscape, hazy light diffusion, floating elements, serene and weightless",
            "retro": "vintage analog film grain, warm faded tones, 70s-80s aesthetic, nostalgic atmosphere",
            "classic": "timeless cinematic composition, rich shadows, golden-era Hollywood lighting",
        },
        "mood": {
            "dark": "dark and tense mood, brooding atmosphere, dramatic shadows, heavy emotional weight",
            "euphoric": "euphoric high-energy mood, vibrant motion, celebratory light bursts",
            "melancholic": "melancholic and introspective, muted tones, slow and contemplative",
            "chaotic": "chaotic frantic energy, overlapping motion, disorienting angles",
        },
        "camera": {
            "wide": "wide cinematic shot, expansive composition, epic scale",
            "close": "intimate close-up, raw detail, shallow depth of field",
            "drone": "aerial drone perspective, sweeping landscape view, high altitude",
            "slow_motion": "ultra slow motion, fluid graceful movement, motion blur trails",
        },
        "color_grade": {
            "cold_blue": "cold blue color grade, icy highlights, desaturated shadows",
            "warm_golden": "warm golden hour color grade, rich amber tones, soft glowing highlights",
            "desaturated": "desaturated muted palette, near-monochrome, subtle color hints",
            "high_contrast": "high contrast grade, deep blacks, blown highlights, punchy saturation",
        },
    }

    parts = [
        fragments["theme"].get(theme, theme),
        fragments["mood"].get(mood, mood),
        fragments["camera"].get(camera, camera),
        fragments["color_grade"].get(color_grade, color_grade),
    ]
    return ", ".join(p for p in parts if p)


def generate_image_prompt(
    theme: str,
    mood: str,
    camera: str,
    color_grade: str,
    user_notes: str = "",
) -> str:
    assembled_style = build_prompt(theme, mood, camera, color_grade)

    system = (
        "You are a creative director specializing in AI-generated music videos. "
        "Given a style description and optional director notes, write a single rich image generation prompt "
        "suitable for Stable Diffusion or Midjourney. Be specific, visual, and cinematic. "
        "Output only the prompt — no explanation."
    )

    user_content = f"Style: {assembled_style}"
    if user_notes:
        user_content += f"\nDirector notes: {user_notes}"

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )

    return message.content[0].text


if __name__ == "__main__":
    prompt = generate_image_prompt(
        theme="futuristic",
        mood="dark",
        camera="wide",
        color_grade="cold_blue",
        user_notes="main subject is a lone figure standing in a flooded city",
    )
    print(prompt)
