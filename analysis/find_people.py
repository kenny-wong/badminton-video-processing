"""Finds and follows the people in a match video, for showing the players
with their names (lib/people.js, public/shared/people.js).

Runs Ultralytics YOLO11 pose with its ByteTrack tracker, so each person keeps
an id from frame to frame. For each person in each frame it writes the box and
the point between the ankles (or the bottom middle of the box when the ankles
aren't seen), as fractions of the picture, and the colour of their shirt
(the middle of the upper body, in CIE Lab), which tells doubles partners apart.

    python find_people.py --video input.mp4 --out people.json [--model yolo11m-pose.pt]

The model's weights are downloaded into the working folder the first time.
Progress lines "frame i/n" go to stdout.
"""

import argparse
import json

import cv2
from ultralytics import YOLO

LEFT_ANKLE, RIGHT_ANKLE = 15, 16


def shirt_colour(image, x1, y1, x2, y2):
    """Mean Lab colour of the middle of the upper body, or None for a tiny box."""
    h, w = y2 - y1, x2 - x1
    top, bottom = int(y1 + 0.2 * h), int(y1 + 0.45 * h)
    left, right = int(x1 + 0.3 * w), int(x2 - 0.3 * w)
    if bottom - top < 2 or right - left < 2:
        return None
    crop = image[max(0, top):bottom, max(0, left):right]
    if crop.size == 0:
        return None
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(axis=0)
    # OpenCV's 8-bit Lab: L 0-255 -> 0-100, a and b offset by 128.
    return [round(float(lab[0]) * 100 / 255, 1), round(float(lab[1]) - 128, 1), round(float(lab[2]) - 128, 1)]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="yolo11m-pose.pt")
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--min-ankle", type=float, default=0.5)
    args = parser.parse_args()

    capture = cv2.VideoCapture(args.video)
    fps = capture.get(cv2.CAP_PROP_FPS) or 10
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    capture.release()

    model = YOLO(args.model)
    frames = []
    width = height = None
    results = model.track(source=args.video, stream=True, persist=True, classes=[0], tracker="bytetrack.yaml",
                          conf=args.conf, imgsz=args.imgsz, verbose=False)
    for i, result in enumerate(results):
        image = result.orig_img
        height, width = image.shape[:2]
        people = []
        boxes = result.boxes
        if boxes is not None and len(boxes):
            ids = boxes.id.int().tolist() if boxes.id is not None else [None] * len(boxes)
            points = result.keypoints.xy.tolist() if result.keypoints is not None else None
            point_conf = result.keypoints.conf.tolist() if result.keypoints is not None and result.keypoints.conf is not None else None
            for k, (box, conf) in enumerate(zip(boxes.xyxy.tolist(), boxes.conf.tolist())):
                x1, y1, x2, y2 = box
                ankles = []
                if points is not None and point_conf is not None:
                    ankles = [points[k][a] for a in (LEFT_ANKLE, RIGHT_ANKLE) if point_conf[k][a] >= args.min_ankle]
                if ankles:
                    fx = sum(a[0] for a in ankles) / len(ankles)
                    fy = sum(a[1] for a in ankles) / len(ankles)
                else:
                    fx, fy = (x1 + x2) / 2, y2
                people.append([
                    ids[k],
                    round(x1 / width, 4), round(y1 / height, 4), round(x2 / width, 4), round(y2 / height, 4),
                    round(conf, 2),
                    round(fx / width, 4), round(fy / height, 4),
                    shirt_colour(image, x1, y1, x2, y2),
                ])
        frames.append([round(i / fps, 3), people])
        if i % 25 == 0:
            print(f"frame {i + 1}/{total}", flush=True)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"fps": fps, "width": width, "height": height, "frames": frames}, f)
    print(f"frame {len(frames)}/{total}", flush=True)


if __name__ == "__main__":
    main()
