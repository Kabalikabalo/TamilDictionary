import requests
import random

WORDS = [
    "paint", "tree", "water", "light", "book",
    "music", "flower", "river", "cloud", "stone",
    "dream", "mountain", "bird", "fire", "earth",
    "sky", "wind", "love", "star", "path"
]

URL = "https://tamildictionary.onrender.com/word/{}"

def main():
    word = random.choice(WORDS)
    url = URL.format(word)
    try:
        requests.get(url, timeout=10)
    except Exception:
        # We silently ignore all errors — purpose is just to hit the endpoint
        pass

if __name__ == "__main__":
    main()
