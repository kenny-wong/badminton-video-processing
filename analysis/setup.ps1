# Sets up shuttle tracking (TrackNetV3) and voice removal (Demucs) for Badminton
# Video. Run once from the project folder (running it again is safe):
#   powershell -ExecutionPolicy Bypass -File analysis\setup.ps1
# Needs Python 3.10+ and Git. Downloads about 3.5 GB (PyTorch with CUDA, the
# TrackNetV3 code, Demucs and their trained models). Nothing here goes into the repo.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path '.venv')) { python -m venv .venv }
$py = Join-Path $root '.venv\Scripts\python.exe'
& $py -m pip install --upgrade pip
# PyTorch built for NVIDIA GPUs (CUDA 12.1); it falls back to the CPU without one, slowly.
& $py -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121
& $py -m pip install "numpy<2" opencv-python pandas Pillow tqdm parse gdown pycocotools matplotlib
# Demucs takes voices out of the sound (remove_voices.py). torchaudio first, from the same CUDA
# build as torch, or pip would swap torch for a newer CPU-only one to satisfy Demucs.
& $py -m pip install torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121
& $py -m pip install demucs==4.0.1
# Ultralytics YOLO (AGPL-3.0, installed here only, not shipped) finds and follows the players
# (find_people.py). torchvision first, from the same CUDA build as torch, for the same reason.
& $py -m pip install torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121
& $py -m pip install "numpy<2" ultralytics lap

if (-not (Test-Path 'vendor\TrackNetV3')) {
  New-Item -ItemType Directory -Force vendor | Out-Null
  git clone --depth 1 https://github.com/qaz812345/TrackNetV3.git vendor\TrackNetV3
}

if (-not (Test-Path 'ckpts\TrackNet_best.pt')) {
  # The authors' trained models (MIT licence), from the link in their README.
  & $py -m gdown 'https://drive.google.com/uc?id=1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA' -O TrackNetV3_ckpts.zip
  Expand-Archive TrackNetV3_ckpts.zip -DestinationPath . -Force
  Remove-Item TrackNetV3_ckpts.zip
}

# The model files must hold only weights (no code), so load them in PyTorch's safe mode.
& $py -I -c "import torch; [torch.load(f, map_location='cpu', weights_only=True) for f in ('ckpts/TrackNet_best.pt', 'ckpts/InpaintNet_best.pt')]; print('Models OK. GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none (CPU only)')"

# Demucs' fine-tuned models (about 320 MB, into the PyTorch cache in your user folder), fetched
# now rather than on the first render. Demucs checks each file against the hash in its name.
& $py -I -W ignore -c "from demucs.pretrained import get_model; get_model('htdemucs_ft'); print('Demucs models OK')"
