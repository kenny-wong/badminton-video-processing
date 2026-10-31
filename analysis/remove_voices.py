# Takes the voices out of a match's sound with Demucs (MIT licence,
# github.com/facebookresearch/demucs), keeping everything else: shuttle hits,
# footsteps, the hall. Run by lib/voices.js:
#
#   python remove_voices.py <in.wav> <out.wav> [--model htdemucs_ft] [--device cuda]
#
# The input is 44.1 kHz 16-bit stereo (FFmpeg makes it); the output is the same.
# Demucs splits sound into vocals, drums, bass and other. Only the vocals are
# needed, so from a bag of fine-tuned models (one per part) only the vocals
# model runs, and the result is the input minus its vocals: nothing but the
# voices is changed. Long files go through in chunks, each with a few seconds
# of context either side, so memory stays small; "chunk i/n" lines report
# progress.

import argparse
import sys
import warnings
import wave

import numpy as np
import torch
from demucs.apply import BagOfModels, apply_model
from demucs.pretrained import get_model

CHUNK_SECONDS = 300
CONTEXT_SECONDS = 5

# Demucs loads its models with torch.load, which warns about pickled files on
# every load. They come from Demucs' own download address and are checked
# against the hash in their file names.
warnings.filterwarnings('ignore', category=FutureWarning)


def vocals_model(name):
    model = get_model(name)
    if isinstance(model, BagOfModels):
        v = model.sources.index('vocals')
        best = max(range(len(model.models)), key=lambda i: model.weights[i][v])
        sub = model.models[best]
        sub.eval()
        return sub
    model.eval()
    return model


def read_wav(path):
    with wave.open(path, 'rb') as w:
        if w.getsampwidth() != 2:
            sys.exit('Expected 16-bit sound')
        rate, channels = w.getframerate(), w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, channels).T
    if channels == 1:
        data = np.repeat(data, 2, axis=0)
    return data[:2], rate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--model', default='htdemucs_ft')
    ap.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    args = ap.parse_args()

    model = vocals_model(args.model).to(args.device)
    vocals = model.sources.index('vocals')
    data, rate = read_wav(args.input)
    if rate != model.samplerate:
        sys.exit(f'Expected {model.samplerate} Hz sound, got {rate} Hz')
    print(f'Model {args.model} on {args.device}' + (f' ({torch.cuda.get_device_name(0)})' if args.device == 'cuda' else ''), flush=True)

    length = data.shape[1]
    # Demucs expects sound scaled like its training data: the whole file's mean and spread.
    mono = data.mean(axis=0, dtype=np.float64) / 32768
    mean, std = float(mono.mean()), float(mono.std()) or 1.0
    chunk, context = CHUNK_SECONDS * rate, CONTEXT_SECONDS * rate
    count = max(1, -(-length // chunk))
    print(f'Sound length {length / rate:.1f} s, {count} chunk{"s" if count > 1 else ""}', flush=True)

    with wave.open(args.output, 'wb') as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(rate)
        for i in range(count):
            start, end = i * chunk, min(length, (i + 1) * chunk)
            lo, hi = max(0, start - context), min(length, end + context)
            mix = torch.from_numpy(data[:, lo:hi].astype(np.float32) / 32768)
            with torch.no_grad():
                parts = apply_model(model, ((mix - mean) / std)[None], device=args.device, shifts=0, split=True, overlap=0.25, progress=False)[0]
            voice = parts[vocals] * std  # the mean belongs to the rest, not the voices
            rest = (mix - voice)[:, start - lo:end - lo].numpy()
            out.writeframes((np.clip(rest, -1, 32767 / 32768) * 32768).round().astype(np.int16).T.tobytes())
            print(f'chunk {i + 1}/{count}', flush=True)
    print('Done', flush=True)


if __name__ == '__main__':
    main()
