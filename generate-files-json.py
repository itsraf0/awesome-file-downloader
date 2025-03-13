import os
import json
from pathlib import Path

def scan_directory(path):
    result = {
        "files": [],
        "directories": {}
    }
    
    try:
        for item in os.listdir(path):
            if item.startswith('.'):  # Skip hidden files
                continue
                
            full_path = os.path.join(path, item)
            if os.path.isfile(full_path):
                result["files"].append(item)
            elif os.path.isdir(full_path):
                result["directories"][item] = scan_directory(full_path)
    except Exception as e:
        print(f"Error scanning {path}: {e}")
        
    return result

# Scan the files directory and create files.json
base_path = "files"
file_system = scan_directory(base_path)

with open("files.json", "w", encoding="utf-8") as f:
    json.dump(file_system, f, ensure_ascii=False, indent=2)

print("files.json has been created!")