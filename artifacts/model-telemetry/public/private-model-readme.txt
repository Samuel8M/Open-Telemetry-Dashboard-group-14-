PRIVATE MODEL — LOCAL DOWNLOAD, WEIGHT INSPECTION, AND LoRA

This standalone Python CLI works with seven curated public open-weight model
repositories only. The license shown is the repository's model-card license
at catalog verification; check its current terms before downloading:

  smollm2-135m  -> HuggingFaceTB/SmolLM2-135M-Instruct  (Llama, Apache-2.0)
  smollm2-360m  -> HuggingFaceTB/SmolLM2-360M-Instruct  (Llama, Apache-2.0)
  qwen2.5-0.5b  -> Qwen/Qwen2.5-0.5B-Instruct          (Qwen2, Apache-2.0)
  qwen2.5-1.5b  -> Qwen/Qwen2.5-1.5B-Instruct          (Qwen2, Apache-2.0)
  tinyllama-1.1b -> TinyLlama/TinyLlama-1.1B-Chat-v1.0 (Llama, Apache-2.0)
  pythia-160m   -> EleutherAI/pythia-160m               (GPT-NeoX, Apache-2.0)
  pythia-410m   -> EleutherAI/pythia-410m               (GPT-NeoX, Apache-2.0)

The script contains a fixed allowlist. It does not accept arbitrary repository
IDs, use gated-model assumptions, execute repository code, or support GGUF.
Each preset pins a specific public repository revision and checks the local
architecture and LoRA module weights before use. Pythia checkpoints are base
completion models, not instruction/chat-tuned; their responses to chat prompts
may be continuations rather than helpful answers.

PRIVACY AND NETWORK BOUNDARIES

- `download` is the explicit opt-in to fetch public model files from Hugging
  Face. The files are placed in ./private-models/<model-key>. The downloader
  requests safetensors weights, config, and tokenizer assets only from a pinned
  revision; it does not download or execute custom model code.
- `train` does not download models or call hosted services. It sets Hugging
  Face/Transformers offline flags and disables WandB/telemetry before importing
  ML libraries, then loads the already-downloaded model with local-files-only
  settings. Training data is read only when `train` runs and is used in that
  local process. It is not sent to this web app or a remote API.
- `chat` also sets offline flags and loads local files only. It prints a base
  model response, and with `--adapter`, a second response using the local LoRA
  adapter. Prompts are processed locally.
- `inspect` reads safetensors headers and local config metadata only. It does
  not load tensor payloads or inspect training data. Its small JSON report
  contains at most 12 tensor descriptions and no file content.
- Python package installation and the first public model download require
  internet access. Package installers contact their package index; model
  downloads contact the selected Hugging Face repository. After setup, train,
  inspect, and chat are intended to work offline.
- For an independent network boundary, disconnect Wi-Fi or other internet
  access before running `train` or `chat`. The CLI's offline library settings
  are not a system firewall; neither command needs a connection after setup.

SETUP — macOS

1. Install Python 3.10 or newer from https://www.python.org/downloads/macos/
   or use a current Python installation already on the computer.
2. Put private-model.py and this guide in the same folder. Open Terminal and
   change to that folder.
3. Create and activate a virtual environment, then install dependencies:

       python3 -m venv .venv
       source .venv/bin/activate
       python -m pip install --upgrade pip
       python -m pip install torch transformers peft accelerate huggingface_hub

   PyTorch installation availability varies by macOS version and processor.
   Consult https://pytorch.org/get-started/locally/ if its installer gives an
   error. The script uses CPU when CUDA is unavailable.
4. Check the installation:

       python private-model.py doctor
       python private-model.py --self-test

SETUP — WINDOWS

1. Install Python 3.10 or newer from https://www.python.org/downloads/windows/
   and enable the Python launcher (`py`) during installation.
2. Put private-model.py and this guide in the same folder. Open PowerShell and
   change to that folder.
3. Create and activate a virtual environment, then install dependencies:

       py -m venv .venv
       .\.venv\Scripts\Activate.ps1
       python -m pip install --upgrade pip
       python -m pip install torch transformers peft accelerate huggingface_hub

   If PowerShell blocks environment activation, use the environment's Python
   directly with `.venv\Scripts\python.exe -m pip ...` and
   `.venv\Scripts\python.exe private-model.py ...`.
4. Check the installation:

       python private-model.py doctor
       python private-model.py --self-test

DOWNLOAD A MODEL — EXPLICIT NETWORK OPT-IN

The first download needs an internet connection and several GB of available
disk space, including a safety margin. The CLI applies conservative disk-space
checks; its estimates are guardrails, not exact repository sizes.

macOS:

    python private-model.py download --model smollm2-135m

Windows:

    py private-model.py download --model smollm2-135m

Other allowed keys: `smollm2-360m`, `qwen2.5-0.5b`, `qwen2.5-1.5b`,
`tinyllama-1.1b`, `pythia-160m`, and `pythia-410m`. Downloaded files
are kept in `./private-models/<key>`. A failed or incomplete download is
reported; inspect the local directory and rerun the explicit download command
if necessary. Gated/private repositories and GGUF files are not supported.

INSPECT LOCAL WEIGHT METADATA

After downloading, inspect safetensors headers without reading full weight
payloads:

    python private-model.py inspect --model smollm2-135m --output weight-report.json

The output follows a strict versioned JSON schema and is saved where you
specify. `parameterCount` is the sum of tensor dimensions reported in the
weights; it is not a measure of semantic knowledge, quality, or capability.
Tensor roles are lightweight name-based labels, not a model architecture
analysis. If a LoRA adapter exists locally, its parameter and tensor counts are
included; otherwise `adapter` is null.

PREPARE A PRIVATE TRAINING FILE

The CLI accepts UTF-8 `.txt` files (treated as one text example) or `.jsonl`
files (one JSON value per nonblank line). A JSONL record may be a string, an
object with a string `text` or `content` field, or an object with
`messages[].content` strings. Example:

    {"text":"Our product is called Northstar."}
    {"messages":[{"role":"user","content":"Describe Northstar."},{"role":"assistant","content":"Northstar is our product."}]}

Keep sensitive material on a computer you control. The CLI limits input files
to 5 MiB, text to 2,000,000 characters, and JSONL records to 10,000. It does
not print or include training text in reports.

TRAIN A LOCAL LoRA ADAPTER

Make sure the model has already been downloaded. `train` never downloads a
missing base model and never contacts a hosted service. The 135M preset is the
recommended CPU starting point:

    python private-model.py train --model smollm2-135m --data ./notes.txt --steps 30

Windows:

    py private-model.py train --model smollm2-135m --data .\notes.txt --steps 30

JSONL example:

    python private-model.py train --model smollm2-135m --data ./examples.jsonl --steps 30

The step count must be from 1 to 200 (default 30). Training is genuine PEFT
LoRA fine-tuning with Transformers, PyTorch, and Accelerate. The base
checkpoint is loaded locally and is not modified. Only the adapter is saved
under `./private-adapters/<key>`. Each full input record is tokenized without
truncation and divided into chunks of at most 512 tokens; a `.txt` file is one
record, so later paragraphs are included too. Record boundaries use an EOS
separator when the tokenizer provides one. Tiny one-token tails are balanced
into a trainable two-token chunk; input with fewer than two total tokens fails
explicitly.

To keep training bounded, the maximum dataset is `steps * 4` chunks, where 4
is the gradient-accumulation count. At the default 30 steps, up to 120 chunks
(at most 61,440 token positions before padding) are accepted; at the 200-step
maximum, up to 800 chunks are accepted. If all the supplied input would exceed
that limit, training stops with an error instead of silently discarding
trailing text. Increase `--steps` (up to 200) or reduce/curate the input and
retry. With fewer chunks than the requested training batches, the trainer may
cycle through examples to complete all steps. Training uses a batch size of
one. It checks total RAM and free disk against conservative model-specific
guardrails before loading the model.
These checks cannot guarantee that a particular computer has enough available
memory; close other applications if appropriate, and stop if the machine
becomes unstable. Training may be very slow on CPU.

Training refuses to overwrite an existing `./private-adapters/<key>` by
default. To intentionally replace it, add `--overwrite`:

    python private-model.py train --model smollm2-135m --data ./notes.txt --steps 30 --overwrite

The old adapter is retained while the new one trains. It is moved aside only
after the new adapter has been written and validated; if installing the new
directory fails, the CLI attempts to restore the old adapter. If cleanup of a
successfully replaced adapter backup fails, the backup path is printed.

CHAT WITH THE BASE AND ADAPTER

Base model only:

    python private-model.py chat --model smollm2-135m --prompt "What is Northstar?"

Compare with the locally trained adapter:

    python private-model.py chat --model smollm2-135m --prompt "What is Northstar?" --adapter

The adapter flag requires `./private-adapters/<key>/adapter_config.json`.
Generation is deterministic and bounded to 160 new tokens. An adapter is a
separate set of trainable low-rank weights; it is not a rewritten or merged
base model. Chat prints the base result followed by the adapter result so they
can be compared.

MODEL SIZE AND PLATFORM NOTES

- `smollm2-135m` is the smallest, CPU-friendly preset and the recommended
  starting point. Larger models require capable RAM and may be impractical to
  fine-tune on a CPU. The CLI guardrails require at least 4 GiB total RAM for
  SmolLM2 135M and Pythia 160M, 8 GiB for SmolLM2 360M, Pythia 410M and
  Qwen 0.5B, and 12 GiB for TinyLlama 1.1B and Qwen 1.5B. The download
  disk guardrails (plus a 0.5 GiB safety margin) are 1, 2, 2, 3, 3,
  5, and 7 GiB respectively in that order; these are estimates, not exact
  file sizes. Actual training memory requirements can be higher.
- Llama and Qwen2 presets attach LoRA to q_proj/v_proj. GPT-NeoX Pythia
  presets attach LoRA to the fused query_key_value projection. The CLI checks
  the safetensors headers for those weights and refuses changed architectures.
- The script uses CUDA when PyTorch reports it available; otherwise it uses
  CPU. GPU hardware and drivers vary. A guardrail passing does not promise
  successful model loading or training.
- Ollama GGUF files are quantized inference artifacts and are not directly
  editable by this workflow. Download the listed Hugging Face safetensors
  checkpoints instead.
- Model parameter/tensor counts and LoRA adapter size do not directly represent
  semantic concepts, accuracy, or factuality.
- This CLI has not been exercised on actual macOS or Windows computers in the
  hosted development environment. Follow the platform-specific PyTorch
  installation instructions if dependency installation differs.

SELF-TEST AND HELP

The built-in self-tests use only Python's standard library; they do not install
packages, download models, or access network services:

    python private-model.py --self-test
    python private-model.py --help
    python private-model.py train --help

Use `python` on macOS or in an activated Windows virtual environment; use
`py` in Windows PowerShell if no virtual environment is active.