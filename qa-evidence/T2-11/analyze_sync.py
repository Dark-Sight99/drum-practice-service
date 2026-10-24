import cv2
import numpy as np
import wave

VIDEO = r"C:\Users\Jaewoo\Videos\녹음 2026-10-24 211830.mp4"
AUDIO = r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\audio.wav"

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
print("fps", fps, "n_frames", n_frames)

HIT_Y0, HIT_Y1 = 548, 558  # band just above/at the hit line
X0, X1 = 16, 1240  # lane area width (exclude nothing for now)

visual = np.zeros(n_frames, dtype=np.float64)
frame_idx = 0
while True:
    ret, frame = cap.read()
    if not ret:
        break
    band = frame[HIT_Y0:HIT_Y1, X0:X1].astype(np.int32)  # BGR
    b, g, r = band[..., 0], band[..., 1], band[..., 2]
    maxc = np.maximum(np.maximum(b, g), r)
    minc = np.minimum(np.minimum(b, g), r)
    sat = (maxc - minc)
    colored = (sat > 40) & (maxc > 60)
    visual[frame_idx] = colored.sum()
    frame_idx += 1
cap.release()
print("visual series computed, nonzero frames:", np.count_nonzero(visual))

# audio
wf = wave.open(AUDIO, 'rb')
sr = wf.getframerate()
n = wf.getnframes()
raw = wf.readframes(n)
audio = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
wf.close()
print("audio sr", sr, "samples", len(audio))

samples_per_frame = sr / fps
n_vid_frames = len(visual)
audio_env = np.zeros(n_vid_frames)
for i in range(n_vid_frames):
    s0 = int(i * samples_per_frame)
    s1 = int((i + 1) * samples_per_frame)
    if s1 > len(audio):
        break
    seg = audio[s0:s1]
    audio_env[i] = np.sqrt(np.mean(seg ** 2)) if len(seg) else 0

np.save("visual.npy", visual)
np.save("audio_env.npy", audio_env)
print("saved")
