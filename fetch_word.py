import requests
import random
from datetime import datetime

WORDS = [
    "paint", "tree", "water", "light", "book",
    "music", "flower", "river", "cloud", "stone",
    "dream", "mountain", "bird", "fire", "earth",
    "sky", "wind", "love", "star", "path"
]

URL = "https://tamildictionary.onrender.com/word/{}"
LOG_FILE = "tamil_dictionary_log.txt"

def log_message(message: str):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"{message}\n")

def main():
    word = random.choice(WORDS)
    url = URL.format(word)

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        log_message(f"[{timestamp}] Word: {word}")
        log_message(f"[{timestamp}] Response: {data}")
        log_message("-" * 60)

    except Exception as e:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_message(f"[{timestamp}] Error fetching word '{word}': {e}")
        log_message("-" * 60)

if __name__ == "__main__":
    main()
