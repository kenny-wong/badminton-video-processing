"""Runs TrackNetV3's predict.py with its arguments, with three changes that
leave its results as they were:

1. DataLoader worker processes are turned off. On Windows each worker process
   loads all of PyTorch's CUDA libraries again, which runs out of memory ("The
   paging file is too small") and leaves the job hanging.
2. With --large_video, TrackNetV3 builds every 8-frame window from scratch, so
   each frame is resized and converted 8 times, on one CPU core: about 9 frames
   a second, with the GPU mostly idle. Here each frame goes through TrackNetV3's
   own __process__ once and the windows are put together from those, giving
   the same numbers (every value is still the float64 x / 255).
3. The median (background) image is made from one pass through the video
   instead of a seek per sampled frame, which took over a minute.

TRACKNET_ORIGINAL=1 turns 2 and 3 off, to compare against TrackNetV3 as it is.
analysis/check_tracknet_reader.py checks that 2 and 3 give the same arrays.

Usage: python run_tracknet.py <path to TrackNetV3 folder> <predict.py arguments...>
"""

import os
import runpy
import sys

import cv2
import numpy as np


def speed_up(dataset):
    """Replaces Video_IterableDataset's frame reading and median image in TrackNetV3's dataset module."""
    Video = dataset.Video_IterableDataset
    _process = Video.__process__

    def process_one(self, frame):
        """One frame (BGR, as read) as TrackNetV3 processes it inside a window: its channels / 255."""
        seq_len = self.seq_len
        self.seq_len = 1
        try:
            out = _process(self, frame[None, ..., ::-1])
        finally:
            self.seq_len = seq_len
        # In 'concat' mode the median image comes first; it is added once per window instead.
        return out[self.median.shape[0]:] if self.bg_mode == 'concat' else out

    def iterate(self):
        """Video_IterableDataset.__iter__, with each frame processed once."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        head = [self.median / 255.] if self.bg_mode == 'concat' else []
        success = True
        start_f_id, end_f_id = 0, 0
        frame_list = []
        while success:
            while len(frame_list) < self.seq_len:
                success, frame = self.cap.read()
                if not success:
                    break
                frame_list.append(process_one(self, frame))
                end_f_id += 1

            data_idx = [(0, i) for i in range(start_f_id, end_f_id)]
            if len(data_idx) < self.seq_len:
                data_idx.extend([(0, end_f_id-1)]*(self.seq_len - len(data_idx)))
                frame_list.extend([frame_list[-1]]*(self.seq_len - len(frame_list)))
            yield np.array(data_idx), np.concatenate(head + frame_list, axis=0)

            frame_list = frame_list[self.sliding_step:]
            start_f_id = start_f_id + self.sliding_step

        self.cap.release()

    def gen_median(self, max_sample_num, video_range):
        """Video_IterableDataset.__gen_median__, reading the video once in order instead of seeking to each frame."""
        print('Generate median image...')
        if video_range is None:
            start_frame, end_frame = 0, self.video_len
        else:
            start_frame = max(0, video_range[0] * self.fps)
            end_frame = min(video_range[1] * self.fps, self.video_len)
        video_seg_len = end_frame - start_frame
        sample_step = video_seg_len // max_sample_num if video_seg_len > max_sample_num else 1
        wanted = set(range(start_frame, end_frame, sample_step))

        frame_list = []
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        for i in range(start_frame, end_frame):
            success, frame = self.cap.read()
            if not success:
                break
            if i in wanted:
                frame_list.append(frame)
        median = np.median(frame_list, 0)[..., ::-1]
        if self.bg_mode == 'concat':
            median = dataset.Image.fromarray(median.astype('uint8'))
            median = np.array(median.resize(size=(self.WIDTH, self.HEIGHT)))
            median = np.moveaxis(median, -1, 0)
        print('Median image generated.')
        return median

    Video.__iter__ = iterate
    Video.__gen_median__ = gen_median


def main():
    import torch.utils.data as data

    vendor = os.path.abspath(sys.argv[1])
    _DataLoader = data.DataLoader

    class DataLoader(_DataLoader):
        def __init__(self, *args, **kwargs):
            kwargs['num_workers'] = 0
            super().__init__(*args, **kwargs)

    data.DataLoader = DataLoader
    predict = os.path.join(vendor, 'predict.py')
    sys.argv = [predict] + sys.argv[2:]
    sys.path.insert(0, vendor)
    os.chdir(vendor)
    if os.environ.get('TRACKNET_ORIGINAL') != '1':
        import dataset  # TrackNetV3's dataset.py; predict.py imports this same module
        speed_up(dataset)
    runpy.run_path(predict, run_name='__main__')


if __name__ == '__main__':
    main()
