@echo off
setlocal
cd /d "%~dp0"

py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer and the Python launcher are required.
  echo Install Python from python.org, enable the launcher, then try again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating an isolated Python environment...
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Could not create the environment.
    pause
    exit /b 1
  )
)

if not exist ".venv\.model-studio-dependencies-installed" (
  echo First-time setup needs internet and may take a while (PyTorch is large).
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  if errorlevel 1 goto :install_failed
  ".venv\Scripts\python.exe" -m pip install torch transformers peft accelerate huggingface_hub
  if errorlevel 1 goto :install_failed
  type nul > ".venv\.model-studio-dependencies-installed"
)

".venv\Scripts\python.exe" model-studio.py
set "APP_EXIT=%ERRORLEVEL%"
if errorlevel 1 (
  echo Model Studio exited with an error. See the message above.
  pause
)
exit /b %APP_EXIT%

:install_failed
echo Dependency setup failed. Check internet and PyTorch platform support, then retry.
pause
exit /b 1