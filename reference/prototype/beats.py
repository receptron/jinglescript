import sys, librosa, numpy as np
y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False)
rms = librosa.feature.rms(y=y)[0]; t = librosa.times_like(rms, sr=sr)
print("tempo", float(np.atleast_1d(tempo)[0]))
print("beats", [round(float(x), 2) for x in librosa.frames_to_time(beats, sr=sr)])
print("onsets", [round(float(x), 2) for x in onsets])
for s in np.arange(0, 5.2, 0.25):
    m = rms[(t >= s) & (t < s + 0.25)]
    print(f"{s:4.2f} {'#' * int((m.max() if len(m) else 0) * 120)}")
