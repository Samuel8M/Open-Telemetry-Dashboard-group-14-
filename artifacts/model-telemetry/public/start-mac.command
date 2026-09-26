#!/bin/sh
cd "$(dirname "$0")" || {
  echo "Could not open the extracted Model Studio folder."
  printf "Press Return to close this window..."
  if [ -t 0 ]; then IFS= read -r _; else sleep 15; fi
  exit 1
}

pause_on_failure() {
  printf "\n%s\n" "$1"
  printf "Press Return to close this window..."
  if [ -t 0 ]; then IFS= read -r _; else sleep 15; fi
}

if ! command -v python3 >/dev/null 2>&1; then
  pause_on_failure "Python 3.10 or newer is required. Install Python from python.org, then try again."
  exit 1
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  pause_on_failure "Python 3.10 or newer is required."
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating an isolated Python environment..."
  if ! python3 -m venv .venv; then
    pause_on_failure "Could not create .venv. Check the Python installation and folder permissions."
    exit 1
  fi
fi

if [ ! -f ".venv/.model-studio-dependencies-installed" ]; then
  echo "First-time setup needs internet and may take a while (PyTorch is large)."
  if ! .venv/bin/python -m pip install --upgrade pip; then
    pause_on_failure "Dependency setup failed while upgrading pip. Check internet access, then try again."
    exit 1
  fi
  if ! .venv/bin/python -m pip install torch transformers peft accelerate huggingface_hub; then
    pause_on_failure "Dependency setup failed. Check internet and PyTorch platform support, then try again."
    exit 1
  fi
  if ! touch .venv/.model-studio-dependencies-installed; then
    pause_on_failure "Packages installed, but the setup marker could not be written. Check folder permissions."
    exit 1
  fi
fi

.venv/bin/python model-studio.py
app_status=$?
if [ "$app_status" -ne 0 ]; then
  pause_on_failure "Model Studio exited with an error (status $app_status). Review the message above."
fi
exit "$app_status"