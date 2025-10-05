# edit_shards.py
# Interactive editor for shard-based dictionary.
# - Adds/updates entries by exact key in the correct shard (bucketed by first char)
# - Append or rewrite behavior
# - Updates shards/<bucket>.json and shards/manifest.json
# - Keeps JSON pretty (indent=2), UTF-8, and dedupes translations

import json
import os
import sys
from typing import List, Dict

# --- Configuration ------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SHARDS_DIR = r"C:\Users\thear\TamilDictionary\shards"
MANIFEST_PATH = os.path.join(SHARDS_DIR, "manifest.json")


# --- Helpers -----------------------------------------------------------------
def bucket_of(key: str) -> str:
    """Bucket by first Unicode codepoint of the trimmed key; lowercase ASCII."""
    if not isinstance(key, str):
        return "_misc"
    k = key.strip()
    if not k:
        return "_misc"
    # Use full unicode awareness for first char
    first = next(iter(k), "_") if isinstance(k, str) else "_"

    return first or "_misc"

def shard_path_for(bucket: str) -> str:
    return os.path.join(SHARDS_DIR, f"{bucket}.json")

def load_json(path: str) -> Dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: str, obj: Dict) -> None:
    # pretty for readability
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def ensure_dirs() -> None:
    os.makedirs(SHARDS_DIR, exist_ok=True)

def dedupe_keep_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for s in items:
        k = s
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out

def parse_translations(line: str) -> List[str]:
    if line is None:
        return []
    line = line.strip()
    if not line:
        return []
    # If there is a comma, split; otherwise treat as single item
    parts = [p.strip() for p in line.split(",")] if "," in line else [line]
    # Remove empties
    parts = [p for p in parts if p]
    return parts

def choose_target_list(entry: Dict) -> str:
    """
    Where to append? Rules:
    - If 'default' exists and is a list → use 'default'
    - Else: first list-valued field if any
    - Else: create 'default'
    """
    if isinstance(entry, dict):
        if isinstance(entry.get("default"), list):
            return "default"
        for k, v in entry.items():
            if isinstance(v, list):
                return k
    return "default"

def show_entry(key: str, entry: Dict) -> None:
    print("\nCurrent entry:")
    print(json.dumps({key: entry}, ensure_ascii=False, indent=2))


# --- Manifest handling --------------------------------------------------------
def update_manifest_for_bucket(bucket: str, shard_obj: Dict) -> None:
    manifest = {}
    if os.path.exists(MANIFEST_PATH):
        try:
            manifest = load_json(MANIFEST_PATH)
        except Exception:
            manifest = {}
    # manifest keys are bucket chars; value = {"file": "<bucket>.json", "keys": N}
    manifest[bucket] = {
        "file": f"{bucket}.json",
        "keys": len(shard_obj),
    }
    save_json(MANIFEST_PATH, manifest)


# --- Core editing ops ---------------------------------------------------------
def add_new_entry(shard_obj: Dict, key: str, translations: List[str]) -> None:
    translations = [t.strip() for t in translations if t.strip()]
    translations = dedupe_keep_order(translations)
    shard_obj[key] = {"default": translations}

def append_to_entry(shard_obj: Dict, key: str, translations: List[str]) -> None:
    entry = shard_obj.get(key)
    if not isinstance(entry, dict):
        add_new_entry(shard_obj, key, translations)
        return
    target_field = choose_target_list(entry)
    if target_field not in entry or not isinstance(entry.get(target_field), list):
        entry[target_field] = []
    current = entry[target_field]
    if current and isinstance(current[0], list):
        # Append to the first (inner) list
        inner = current[0]
        inner += [t.strip() for t in translations if t.strip()]
        # Deduplicate inner list
        current[0] = dedupe_keep_order(inner)
    else:
        # Append to the outer list
        current += [t.strip() for t in translations if t.strip()]
        entry[target_field] = dedupe_keep_order(current)
    shard_obj[key] = entry

def rewrite_entry(shard_obj: Dict, key: str, translations: List[str]) -> None:
    add_new_entry(shard_obj, key, translations)


# --- Interactive loop ---------------------------------------------------------
def main():
    ensure_dirs()
    print(f"🧩 Shard editor\n- Shards folder: {SHARDS_DIR}\n- Manifest: {MANIFEST_PATH}\n")
    print("Type a key to add/update. Press Enter with empty input or type 'quit' to exit.\n")

    while True:
        try:
            key = input("Key (Tamil or English): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if not key or key in {"q", "quit", "exit"}:
            print("Bye!")
            break

        bucket = bucket_of(key)
        path = shard_path_for(bucket)
        shard = load_json(path)

        exists = key in shard
        if exists:
            show_entry(key, shard[key])
            # ask append or rewrite
            while True:
                mode = input("Append (a) / Rewrite (r) / Skip (s)? ").strip()
                if mode in {"a", "append", "r", "rewrite", "s", "skip"}:
                    break
                print("Please type 'a' to append, 'r' to rewrite, or 's' to skip.")

            if mode in {"s", "skip"}:
                print("Skipped.\n")
                continue

            # Ask new translations
            line = input("Enter translations (comma-separated for multiple): ").strip()
            translations = parse_translations(line)
            if not translations:
                print("No translations provided. Skipped.\n")
                continue

            if mode in {"a", "append"}:
                append_to_entry(shard, key, translations)
                action = "Appended"
            else:
                rewrite_entry(shard, key, translations)
                action = "Rewrote"

        else:
            # New entry
            print("No entry found; creating a new one under 'default'.")
            line = input("Enter translations (comma-separated for multiple): ").strip()
            translations = parse_translations(line)
            if not translations:
                print("No translations provided. Skipped.\n")
                continue
            add_new_entry(shard, key, translations)
            action = "Added"

        # Save shard and update manifest count for this bucket
        save_json(path, shard)
        update_manifest_for_bucket(bucket, shard)

        print(f"✅ {action} '{key}' in shard '{bucket}.json'.\n")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("Error:", e)
        sys.exit(1)
