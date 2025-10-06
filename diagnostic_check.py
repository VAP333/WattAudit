# diagnostic_check.py
import os
import re
import json
import ast
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

console = Console()

# ============================================================
#  BACKEND FILE SCANNING CONFIG
# ============================================================
FILES_TO_SCAN = [
    "train_model.py",
    "tune_model.py",
    "tune_and_train.py",
    "backend/main.py",
    "generate_top50.py",
    "pipeline.py",
]

FEATURE_PATTERN = re.compile(r"features\s*=\s*\[([^\]]+)\]")

# ============================================================
#  FRONTEND LOCALE SCANNING CONFIG
# ============================================================
LOCALES_PATH = "frontend/src/i18n/locales"
LOCALE_FILES = {
    "en": os.path.join(LOCALES_PATH, "en.ts"),
    "hi": os.path.join(LOCALES_PATH, "hi.ts"),
    "mr": os.path.join(LOCALES_PATH, "mr.ts"),
}

FRONTEND_SRC_PATH = "frontend/src"


# ============================================================
#  UTILS
# ============================================================
def read_file(filepath):
    if not os.path.exists(filepath):
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


# ============================================================
#  BACKEND SCANS
# ============================================================
def scan_labels(content):
    results = []
    if "anomaly_label" in content:
        label_assignments = re.findall(r"anomaly_label\s*=\s*.*", content)
        for line in label_assignments:
            if "-1" in line and "1" in line:
                results.append(("✅", "Label assignment uses -1 / 1", line.strip()))
            elif "1" in line and "0" in line:
                results.append(("⚠️", "Label assignment uses 0/1 instead of -1/1", line.strip()))
            else:
                results.append(("❌", "Unclear anomaly label convention", line.strip()))
    return results


def scan_if_lof(content):
    results = []
    if "IsolationForest" in content:
        df_funcs = "decision_function" in content
        score_funcs = "score_samples" in content
        if df_funcs and not score_funcs:
            results.append(("⚠️", "IF uses decision_function only (check direction)", ""))
        elif score_funcs:
            results.append(("✅", "IF uses score_samples (good)", ""))
    if "LocalOutlierFactor" in content:
        novelties = re.findall(r"novelty\s*=\s*(True|False)", content)
        if len(set(novelties)) > 1:
            results.append(("❌", "Mixed novelty settings in LOF", str(novelties)))
        elif novelties:
            results.append(("✅", f"LOF novelty={novelties[0]}", ""))
    return results


def scan_features(content):
    matches = FEATURE_PATTERN.findall(content)
    if matches:
        raw = matches[0]
        features = [f.strip().strip("'\"") for f in raw.split(",")]
        return features
    return []


# ============================================================
#  LOCALE SCANS
# ============================================================
def parse_locale_file(path):
    """
    Simple parser for TS translation files:
    export default { key: "value", nested: { key: "value" } }
    """
    content = read_file(path)
    if not content:
        return None
    # Strip export default
    content = re.sub(r"export\s+default\s+", "", content)
    content = content.strip().rstrip(";")

    # Replace TS syntax with JSON compatible
    content = content.replace("'", '"')
    content = re.sub(r"(\w+):", r'"\1":', content)

    try:
        data = json.loads(content)
        return data
    except json.JSONDecodeError as e:
        console.print(f"[red]❌ Failed to parse locale file {path}: {e}[/red]")
        return None


def flatten_keys(d, prefix=""):
    keys = []
    for k, v in d.items():
        full = f"{prefix}{k}" if prefix == "" else f"{prefix}.{k}"
        if isinstance(v, dict):
            keys.extend(flatten_keys(v, full))
        else:
            keys.append(full)
    return keys


def scan_locale_consistency():
    console.rule("[bold yellow]Locale File Consistency Check")
    all_keys = {}

    for lang, path in LOCALE_FILES.items():
        if not os.path.exists(path):
            console.print(f"❌ [red]{lang}.ts not found at {path}[/red]")
            continue
        data = parse_locale_file(path)
        if data:
            all_keys[lang] = set(flatten_keys(data))

    if len(all_keys) < 2:
        console.print("[red]❌ Missing locale files for comparison[/red]")
        return

    en_keys = all_keys.get("en", set())
    for lang in ["hi", "mr"]:
        keys = all_keys.get(lang, set())
        missing = en_keys - keys
        extra = keys - en_keys
        if missing:
            console.print(f"⚠️ [yellow]{lang}.ts is missing keys:[/yellow] {missing}")
        if extra:
            console.print(f"⚠️ [yellow]{lang}.ts has extra keys:[/yellow] {extra}")
        if not missing and not extra:
            console.print(f"✅ [green]{lang}.ts matches en.ts keys exactly[/green]")


def scan_unused_translation_keys():
    console.rule("[bold yellow]Unused Translation Key Scan")

    used_keys = set()
    key_pattern = re.compile(r"t\(['\"]([^'\"]+)['\"]\)")
    for root, _, files in os.walk(FRONTEND_SRC_PATH):
        for file in files:
            if file.endswith((".ts", ".tsx")):
                content = read_file(os.path.join(root, file))
                if content:
                    used_keys.update(key_pattern.findall(content))

    # collect all keys from en.ts
    en_data = parse_locale_file(LOCALE_FILES["en"])
    if not en_data:
        console.print("[red]❌ Could not parse en.ts for key extraction[/red]")
        return

    all_keys = set(flatten_keys(en_data))
    unused = all_keys - used_keys

    if unused:
        console.print(f"⚠️ [yellow]Found {len(unused)} unused translation keys:[/yellow]")
        for key in sorted(unused):
            console.print(f"   • {key}")
    else:
        console.print("✅ [green]No unused translation keys found[/green]")


# ============================================================
#  MAIN
# ============================================================
def main():
    console.print(Panel("[bold cyan]🔍 WattAudit++ Full Diagnostic Check[/bold cyan]", expand=False))

    # ----------------------------
    # Backend scan
    # ----------------------------
    table = Table(title="Backend Scan", box=box.SIMPLE_HEAVY)
    table.add_column("File", style="cyan")
    table.add_column("Status", style="bold")
    table.add_column("Message")
    table.add_column("Details", style="dim")

    feature_map = {}
    for filename in FILES_TO_SCAN:
        content = read_file(filename)
        if not content:
            table.add_row(filename, "❌", "File not found", "")
            continue

        for status, msg, details in scan_labels(content):
            table.add_row(filename, status, msg, details)

        for status, msg, details in scan_if_lof(content):
            table.add_row(filename, status, msg, details)

        feats = scan_features(content)
        if feats:
            feature_map[filename] = feats

    console.print(table)

    # ----------------------------
    # Feature consistency
    # ----------------------------
    console.rule("[bold yellow]Feature Consistency Check")
    train_feats = feature_map.get("train_model.py", [])
    infer_feats = feature_map.get("backend/main.py", [])

    if train_feats and infer_feats:
        if train_feats != infer_feats:
            console.print("⚠️ [yellow]Mismatch between training and inference features[/yellow]")
            console.print(f" • train_model.py: {train_feats}")
            console.print(f" • main.py: {infer_feats}")
        else:
            console.print("✅ [green]Training and inference features match exactly[/green]")
    else:
        console.print("❌ [red]Could not find feature definitions in train_model.py or backend/main.py[/red]")

    # ----------------------------
    # Locale scanning
    # ----------------------------
    scan_locale_consistency()
    scan_unused_translation_keys()

    console.rule("[bold green]Diagnostic Completed")
    console.print("[bold cyan]⚠️ Review warnings and ❌ errors above to fix issues.[/bold cyan]")


if __name__ == "__main__":
    main()
