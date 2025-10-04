# pipeline.py
import os

print("🚀 Starting full fraud detection pipeline...")

os.system("python train_model.py")
os.system("python evaluate_and_log.py")
os.system("python merge_and_analyze.py")

print("✅ Pipeline finished! All outputs are saved.")
