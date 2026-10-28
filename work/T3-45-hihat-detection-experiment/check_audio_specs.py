import subprocess
import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
files = [
    r"C:\Users\Jaewoo\드럼연습서비스\음원\pretender.mp4",
    r"C:\Users\Jaewoo\드럼연습서비스\음원\pretender_녹화버전.mp4",
    r"C:\Users\Jaewoo\드럼연습서비스\음원\Official髭男dism - Pretender［Official Video］ (1).mp3",
]
for f in files:
    print("===", f, "===")
    proc = subprocess.run([ffmpeg, "-i", f], capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in proc.stderr.splitlines():
        if "Duration" in line or "Audio" in line or "Stream" in line:
            print(" ", line.strip())
    print()
