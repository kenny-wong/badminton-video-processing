"""Checks that run_tracknet.py's faster frame reading gives TrackNetV3 exactly
the same input as its own: the same median image and the same windows.
CPU only (the model isn't loaded).

Usage: python check_tracknet_reader.py <path to TrackNetV3 folder> <video> [max windows]
"""

import hashlib
import importlib
import os
import sys
import time

import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
vendor = os.path.abspath(sys.argv[1])
video = os.path.abspath(sys.argv[2])
limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
sys.path.insert(0, vendor)
sys.path.insert(0, here)

import dataset  # noqa: E402
import run_tracknet  # noqa: E402


def windows(ds):
    """A fingerprint of each window (indices, dtype, shape, values); a window is 32 MB, too big to keep them all."""
    out = []
    start = time.time()
    for n, (idx, frames) in enumerate(ds):
        out.append(hashlib.sha1(idx.tobytes() + str((frames.dtype, frames.shape)).encode() + frames.tobytes()).hexdigest())
        if limit and n + 1 >= limit:
            break
    return out, time.time() - start


def make(bg_mode):
    t = time.time()
    ds = dataset.Video_IterableDataset(video, seq_len=8, sliding_step=1, bg_mode=bg_mode, max_sample_num=1800)
    return ds, time.time() - t


ok = True
for bg_mode in ['concat', '']:
    importlib.reload(dataset)
    old, old_median_s = make(bg_mode)
    old_windows, old_s = windows(old)
    run_tracknet.speed_up(dataset)
    new, new_median_s = make(bg_mode)
    new_windows, new_s = windows(new)

    same_median = (not bg_mode) or (old.median.dtype == new.median.dtype and np.array_equal(old.median, new.median))
    same = old_windows == new_windows
    ok = ok and same_median and same
    print(f"bg_mode={bg_mode!r}: {len(old_windows)} windows; median same: {same_median} "
          f"({old_median_s:.1f} s -> {new_median_s:.1f} s); windows same: {same} ({old_s:.1f} s -> {new_s:.1f} s)")

print('OK' if ok else 'DIFFERENT')
sys.exit(0 if ok else 1)
