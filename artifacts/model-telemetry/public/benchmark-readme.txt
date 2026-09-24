LOCAL OLLAMA MODEL BENCHMARK

This runner downloads and executes selected open-weight models on your own
computer through Ollama, then exports run files you can import into Model
Telemetry. It supports macOS and Windows. It does not upload prompts, responses,
telemetry, or API keys. Every Ollama request is hard-coded to
http://127.0.0.1:11434; the runner has no option to call a remote host.

WHAT IT MEASURES

- CPU and resident RAM used by the visible Ollama model worker and its
  descendants, sampled locally about every 0.5 seconds while generation is in
  flight. CPU averages, resource trends, and peak RAM use only in-flight samples.
  The persistent Ollama service by itself is not counted as a model worker.
- Output tokens per second using Ollama's actual eval_count / eval_duration.
- Wall-clock generation-request duration. The short post-response worker sample
  and model unload are excluded from this duration.
- A transparent, deterministic task score (0–100). This is a narrow automatic
  correctness check, not a human judgment of writing quality:
    * Code fix: parse the proposed Python syntax tree (never execute it) and
      check for the requested age >= 18 condition in is_adult.
    * Data extraction: percentage of five expected JSON fields with exact
      values and types.
    * Document summary: percentage of five predefined source facts detected in
       the summary. This is a limited fact-coverage check, not a complete
       factuality or readability evaluation.
- GPU utilization, first-token latency, and monetary cost remain unavailable.
  The runner does not estimate them.

SETUP — macOS

1. Install Ollama from https://ollama.com/download/mac and start the Ollama app.
2. Install Python 3.10 or later if it is not already available.
3. Download benchmark.py and benchmark-readme.txt to the same folder.
4. In Terminal, change to that folder and install the one dependency:

       python3 -m pip install psutil

   If macOS reports an externally managed Python, use a project virtual
   environment instead:

       python3 -m venv .venv
       source .venv/bin/activate
       python -m pip install psutil

5. Start with the safe small-model run below.

SETUP — WINDOWS

1. Install Ollama from https://ollama.com/download/windows and start Ollama.
2. Install Python 3.10 or later from https://www.python.org/downloads/windows
   and enable the Python launcher (`py`) during setup.
3. Download benchmark.py and benchmark-readme.txt to the same folder.
4. In PowerShell, change to that folder and install the one dependency:

       py -m pip install psutil

   If preferred, isolate the install in a virtual environment:

       py -m venv .venv
       .\.venv\Scripts\Activate.ps1
       python -m pip install psutil

5. Start with the safe small-model run below.

SAFE DEFAULT RUN

macOS:

    python3 benchmark.py

Windows:

    py benchmark.py

The default runs the same three short, laptop-safe workloads once each for
llama3.2:1b and gemma3:1b. The summary scenario is deliberately a short note,
not a long-document benchmark, to keep runs bounded on student laptops.
Defaults are small and bounded: maximum 160 generated tokens per
prompt, no repeated runs, and no model download unless you explicitly ask for
one. Models must already be installed, or opt into a download as described
below. Results are saved under ./telemetry-runs.

MODEL DOWNLOADS REQUIRE EXPLICIT OPT-IN

Ollama model downloads can use multiple gigabytes. `--pull` asks the runner to
pull selected models that are missing. In an interactive terminal, it also
requires you to type the word yes after seeing which models are missing. The
runner checks model-specific total/free RAM and estimated free disk space first.
It also applies a 512 MB disk safety margin and checks Ollama's reported pull
size as progress arrives.

macOS:

    python3 benchmark.py --pull

Windows:

    py benchmark.py --pull

For a script or other non-interactive shell, `--yes` is a separate explicit
confirmation and is accepted only with `--pull`:

    python3 benchmark.py --pull --yes
    py benchmark.py --pull --yes

The low-footprint default tags are llama3.2:1b and gemma3:1b. These are Ollama
registry defaults, not a promise about the bits installed on your machine. After
confirming each model is installed (or pulled), the runner queries Ollama's
`/api/show` and requires an explicit `details.quantization_level` such as
`Q4_K_M`, `Q4_0`, or `IQ4_XS`. Unknown levels and floating-point formats such as
F16/F32 are reported and skipped; no benchmark is run unless quantization is
verified. The exact quantization level is printed before the run. Ollama
manages downloaded files in its own model directory. The runner never downloads
a model without `--pull` and confirmation. Model licenses differ; review the
selected model's license and use terms before downloading or using it.

LARGER PRESETS — EXTRA OPT-IN

Phi-3 Mini and Mistral 7B are not part of the safe default run. They require
`--include-larger` as an additional opt-in and pass conservative memory checks
(8 GB total RAM for Phi-3 Mini; 12 GB for Mistral 7B, plus currently available
RAM). They may be slow or unusable on student laptops with less memory. Do not
close the laptop lid during a model pull or benchmark.

Run all four supported families (only after reviewing the disk/RAM cost):

    python3 benchmark.py --include-larger --pull
    py benchmark.py --include-larger --pull

Select one larger model instead:

    python3 benchmark.py --models phi3:mini --include-larger --pull
    py benchmark.py --models mistral:7b --include-larger --pull

Llama 3 and Gemma can also be selected individually:

    python3 benchmark.py --models llama3.2:1b
    py benchmark.py --models gemma3:1b

REPEATS, WORKLOADS, AND OUTPUT

All selected models receive exactly the same workload text, generation limit,
and deterministic temperature setting. The document-summary workload is a
short laptop-safe note, not a long-document test. Repeat a workload up to 10 times:

    python3 benchmark.py --repeat 3
    py benchmark.py --repeat 3

Run only one scenario:

    python3 benchmark.py --scenarios data-extraction
    py benchmark.py --scenarios code-fix summarization

The code-fix and extraction prompts are synthetic and contain no user files.
The benchmark doesn't read project files, use a shell, or execute model output.
It stores one JSON file per successful model/scenario/repetition. Filenames
include model, workload, repetition, and time. Existing files are not replaced.
`--output-dir PATH` changes the destination. A single benchmark is limited to 30
runs to stay within the dashboard's current local import capacity.

The generation request keeps its model worker resident for 10 seconds so the
runner can verify worker memory and a CPU delta interval after the response.
These post-response samples only validate that the worker persisted: they are
excluded from workload CPU averages, resource trends, and peak RAM. Those
measurements require worker memory and a CPU delta interval while generation is
in flight. If a response is too fast to capture both, the run fails without
export; try a larger `--num-predict` value (up to 512) or a longer workload.
Reported wall-clock duration and tokens/sec still use the actual generation
request and Ollama's eval metrics. The runner then asks Ollama to unload each
model and verifies via `/api/ps` before starting another model. A response
served by the persistent server without the required worker observations is a
failed run with no JSON export. If unload cannot be verified, the runner
reports an error and stops before another model can contaminate its process
measurements.

To start Ollama from the command line if it is installed but not running:

    python3 benchmark.py --start-ollama
    py benchmark.py --start-ollama

The runner otherwise requires Ollama's local service to be available. It does
not stop a service you were already using.

IMPORT THE RUNS

Open Model Telemetry in your browser, choose “Import benchmark JSON”, select all the
JSON files in telemetry-runs (or the directory you chose), and switch to “My
measurements.” Imported runs remain in that browser's local storage. Use “Remove
imported runs” in the dashboard to clear them.

PLATFORM AND MEASUREMENT LIMITATIONS

- Install Ollama only from its official download page. The runner uses Ollama's
  standard local HTTP API and does not configure a network listener.
- Process readings include a visible Ollama model worker (identified by its
  process name/command line or as a descendant of the Ollama service) and its
  descendants. Permission restrictions, platform process naming, competing
  workloads, shared GPU memory, and short-lived peaks can affect results. A
  server-only response is not accepted: without worker memory and CPU-delta
  observations, including a post-response interval, the run fails and no JSON
  is written.
- CPU and RAM samples are approximate model-worker process-tree measurements,
  not application-attributed power or whole-system energy measurements. Worker
  visibility and process naming vary by Ollama version and operating system.
- RAM/disk thresholds are guardrails, not a promise that a model will fit.
  Ollama versions, quantizations, context settings, operating systems, and
  available system memory affect actual requirements. A model may still fail to
  load. Free disk is checked in Ollama's model directory (or OLLAMA_MODELS).
- GPU detection is not implemented. For cloud services, no server-side compute
  is measured. This tool benchmarks only Ollama models running locally.
- Ollama streams pull progress but does not offer a universal cancellation
  guarantee if a client detects an unexpectedly large download; inspect the
  Ollama app/CLI if a pull reports an error.

OPTIONAL VALIDATION

The built-in standard-library tests do not need psutil or Ollama:

    python3 benchmark.py --self-test
    py benchmark.py --self-test
    python3 benchmark.py --help
    py benchmark.py --help