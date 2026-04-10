import os
from datetime import datetime
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from openai import OpenAI
from git import Repo
from config import BOT_TOKEN, OPENAI_API_KEY, NOTES_PATH

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
client = OpenAI(api_key=OPENAI_API_KEY)

repo = Repo(NOTES_PATH)


# --- AI ---
def process_text(text, mode):
    prompt = f"""
    Structure this {mode} note:

    {text}

    Return JSON:
    title, summary, key_points (list), tags (list)
    """

    res = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}],
    )

    return res.choices[0].message.content


# --- Template ---
def render_template(template_name, data):
    with open(f"templates/{template_name}.md") as f:
        template = f.read()

    for k, v in data.items():
        template = template.replace(f"{{{{{k}}}}}", v)

    return template


# --- Save ---
def save_note(content, mode):
    date = datetime.now().strftime("%Y-%m-%d")
    path = f"{NOTES_PATH}/{date}.md"

    with open(path, "a") as f:
        f.write("\n\n---\n\n")
        f.write(content)

    repo.git.add(A=True)
    repo.index.commit(f"update {date}")
    repo.git.push()


# --- Handlers ---
@dp.message(Command("idea"))
async def idea_handler(message: types.Message):
    text = message.text.replace("/idea", "").strip()

    ai = process_text(text, "idea")

    data = {
        "title": "Idea",
        "summary": ai,
        "points": "",
        "raw": text,
        "tags": "#idea",
        "date": str(datetime.now()),
    }

    md = render_template("idea", data)
    save_note(md, "idea")

    await message.answer("Saved")


@dp.message(Command("meeting"))
async def meeting_handler(message: types.Message):
    text = message.text.replace("/meeting", "").strip()

    ai = process_text(text, "meeting")

    data = {
        "title": "Meeting",
        "summary": ai,
        "points": "",
        "raw": text,
        "date": str(datetime.now()),
    }

    md = render_template("meeting", data)
    save_note(md, "meeting")

    await message.answer("Saved")


@dp.message()
async def default_handler(message: types.Message):
    text = message.text

    ai = process_text(text, "note")

    data = {
        "title": "Quick Note",
        "summary": ai,
        "points": "",
        "raw": text,
        "tags": "#note",
        "date": str(datetime.now()),
    }

    md = render_template("idea", data)
    save_note(md, "idea")

    await message.answer("Saved")


if __name__ == "__main__":
    dp.run_polling(bot)