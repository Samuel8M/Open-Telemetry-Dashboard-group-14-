#!/usr/bin/env python3
"""Download, inspect, locally fine-tune, and chat with curated open-weight models."""

import argparse
import datetime
import importlib.util
import json
import os
import platform
import shutil
import struct
import sys
import tempfile
from pathlib import Path


MODELS = {
    "smollm2-135m": {
        "repository": "HuggingFaceTB/SmolLM2-135M-Instruct",
        "minimum_ram": 4,
        "download_bytes": 1024 ** 3,
    },
    "qwen2.5-0.5b": {
        "repository": "Qwen/Qwen2.5-0.5B-Instruct",
        "minimum_ram": 8,
        "download_bytes": 3 * 1024 ** 3,
    },
    "qwen2.5-1.5b": {
        "repository": "Qwen/Qwen2.5-1.5B-Instruct",
        "minimum_ram": 12,
        "download_bytes": 7 * 1024 ** 3,
    },
}

ROOT = Path.cwd()
MODELS_DIR = ROOT / "private-models"
ADAPTERS_DIR = ROOT / "private-adapters"
GIB = 1024 ** 3
MIB = 1024 ** 2
MAX_DATA_BYTES = 5 * MIB
MAX_DATA_CHARS = 2_000_000
MAX_RECORDS = 10_000
MAX_STEPS = 200
MAX_SEQUENCE_LENGTH = 512
GRADIENT_ACCUMULATION_STEPS = 4
REQUIRED_PACKAGES = ("torch", "transformers", "peft", "accelerate")


def set_offline_environment():
    """Disable Hugging Face and third-party telemetry before ML imports."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    os.environ["WANDB_DISABLED"] = "true"
    os.environ["DO_NOT_TRACK"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"


def model_spec(key):
    if key not in MODELS:
        raise RuntimeError("Unsupported model key. Choose one of: " + ", ".join(MODELS))
    return MODELS[key]


def model_directory(key):
    model_spec(key)
    return MODELS_DIR / key


def adapter_directory(key):
    model_spec(key)
    return ADAPTERS_DIR / key


def available_ram_bytes():
    if hasattr(os, "sysconf"):
        try:
            return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))
        except (OSError, ValueError, TypeError):
            pass
    if os.name == "nt":
        try:
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("length", ctypes.c_ulong),
                    ("memory_load", ctypes.c_ulong),
                    ("total_phys", ctypes.c_ulonglong),
                    ("avail_phys", ctypes.c_ulonglong),
                    ("total_page", ctypes.c_ulonglong),
                    ("avail_page", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong),
                    ("avail_virtual", ctypes.c_ulonglong),
                    ("avail_extended_virtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.total_phys)
        except (AttributeError, OSError, TypeError):
            pass
    return None


def free_bytes(path):
    target = Path(path)
    while not target.exists() and target != target.parent:
        target = target.parent
    if not target.exists():
        raise RuntimeError("Cannot locate a filesystem to check free space: " + str(path))
    return shutil.disk_usage(str(target)).free


def check_local_model(key):
    directory = model_directory(key)
    if not directory.is_dir():
        raise RuntimeError(
            "Local model files are missing at " + str(directory)
            + ". Run `python private-model.py download --model " + key + "` first."
        )
    if not list(directory.glob("*.safetensors")):
        raise RuntimeError("No safetensors weights found in " + str(directory) + ". Re-download this model.")
    if not (directory / "config.json").is_file():
        raise RuntimeError("Local config.json is missing from " + str(directory) + ". Re-download this model.")
    return directory


def verify_shard_index(directory):
    for index_path in directory.glob("*.safetensors.index.json"):
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
            shards = set(index.get("weight_map", {}).values())
        except (OSError, json.JSONDecodeError, AttributeError):
            raise RuntimeError("Invalid safetensors shard index: " + str(index_path))
        missing = sorted(name for name in shards if not (directory / name).is_file())
        if missing:
            raise RuntimeError("Model download is incomplete; missing weight shard(s): " + ", ".join(missing))


def command_doctor(_args):
    ram = available_ram_bytes()
    print("Private model CLI doctor")
    print("Python: " + platform.python_version() + " (" + sys.executable + ")")
    print("Platform: " + platform.platform())
    print("Total RAM: " + (format_gib(ram) if ram is not None else "unknown"))
    print("Model directory: " + str(MODELS_DIR))
    print("Adapter directory: " + str(ADAPTERS_DIR))
    print("Optional training/chat packages:")
    for package in REQUIRED_PACKAGES + ("huggingface_hub",):
        print("  " + package + ": " + ("available" if importlib.util.find_spec(package) else "not installed"))
    if ram is not None:
        for key, spec in MODELS.items():
            print("  " + key + " RAM guardrail: " + str(spec["minimum_ram"]) + " GiB total")
    print("No model, training data, or network service was accessed.")


def format_gib(byte_count):
    return "{:.1f} GiB".format(byte_count / GIB)


def command_download(args):
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    key = args.model
    spec = model_spec(key)
    destination = model_directory(key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    required = spec["download_bytes"] + 512 * MIB
    available = free_bytes(destination.parent)
    if available < required:
        raise RuntimeError(
            "Insufficient free disk space for " + key + ": estimated "
            + format_gib(required) + " required including safety margin; "
            + format_gib(available) + " available."
        )
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise RuntimeError(
            "Download requires huggingface_hub. Install it with "
            "`python -m pip install huggingface_hub`."
        ) from error

    print("Downloading the explicitly selected public repository " + spec["repository"])
    print("Destination: " + str(destination))
    try:
        snapshot_download(
            repo_id=spec["repository"],
            local_dir=str(destination),
            allow_patterns=[
                "*.safetensors",
                "*.safetensors.index.json",
                "config.json",
                "generation_config.json",
                "tokenizer*",
                "special_tokens_map.json",
                "added_tokens.json",
                "vocab.json",
                "merges.txt",
                "*.model",
                "*.tiktoken",
            ],
        )
    except Exception as error:
        raise RuntimeError(
            "Public model download failed for " + spec["repository"] + ": " + str(error)
            + ". Check internet access, repository availability, license/terms, and free disk space."
        ) from error
    if not list(destination.glob("*.safetensors")) or not (destination / "config.json").is_file():
        raise RuntimeError(
            "The repository did not provide the required full safetensors weights and config. "
            "No GGUF or remote-code fallback is supported."
        )
    verify_shard_index(destination)
    print("Download complete. Weights are in " + str(destination))


def tensor_role(name):
    lowered = name.lower()
    if "embed" in lowered or "tok_embeddings" in lowered:
        return "embedding"
    if any(part in lowered for part in ("attn", "attention", "q_proj", "k_proj", "v_proj", "o_proj")):
        return "attention"
    if any(part in lowered for part in ("mlp", "gate_proj", "up_proj", "down_proj")):
        return "feed_forward"
    if "norm" in lowered:
        return "normalization"
    if any(part in lowered for part in ("lm_head", "output", "classifier")):
        return "output"
    return "other"


def safetensors_header(path):
    try:
        with path.open("rb") as source:
            prefix = source.read(8)
            if len(prefix) != 8:
                raise RuntimeError("Truncated safetensors header: " + str(path))
            header_length = struct.unpack("<Q", prefix)[0]
            if header_length < 2 or header_length > 64 * MIB:
                raise RuntimeError("Invalid or unusually large safetensors header: " + str(path))
            raw = source.read(header_length)
            if len(raw) != header_length:
                raise RuntimeError("Truncated safetensors header: " + str(path))
    except OSError as error:
        raise RuntimeError("Could not read safetensors header " + str(path) + ": " + str(error)) from error
    try:
        header = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Invalid safetensors JSON header: " + str(path)) from error
    if not isinstance(header, dict):
        raise RuntimeError("Safetensors header is not an object: " + str(path))
    return header


def scan_safetensors(directory):
    files = sorted(directory.glob("*.safetensors"))
    if not files:
        raise RuntimeError("No safetensors files found in " + str(directory))
    total_parameters = 0
    total_tensors = 0
    examples = []
    for path in files:
        header = safetensors_header(path)
        for name, item in header.items():
            if name == "__metadata__":
                continue
            if not isinstance(item, dict) or not isinstance(item.get("shape"), list):
                raise RuntimeError("Malformed tensor metadata in " + str(path) + " for " + str(name))
            shape = item["shape"]
            if any(type(dimension) is not int or dimension < 0 for dimension in shape):
                raise RuntimeError("Invalid tensor shape in " + str(path) + " for " + str(name))
            elements = 1
            for dimension in shape:
                elements *= dimension
            total_parameters += elements
            total_tensors += 1
            if len(examples) < 12:
                dtype = item.get("dtype")
                examples.append({
                    "name": name,
                    "shape": shape,
                    "dtype": dtype if isinstance(dtype, str) else "unknown",
                    "elements": elements,
                    "role": tensor_role(name),
                })
    return total_parameters, total_tensors, examples


def read_architecture(directory):
    try:
        config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not read local model config.json: " + str(error)) from error
    architectures = config.get("architectures")
    if isinstance(architectures, list) and architectures and isinstance(architectures[0], str):
        return architectures[0]
    model_type = config.get("model_type")
    if isinstance(model_type, str) and model_type:
        return model_type
    raise RuntimeError("Local config.json does not identify an architecture.")


def command_inspect(args):
    key = args.model
    spec = model_spec(key)
    directory = check_local_model(key)
    verify_shard_index(directory)
    parameter_count, tensor_count, tensors = scan_safetensors(directory)
    adapter_path = adapter_directory(key)
    adapter = None
    if adapter_path.is_dir() and list(adapter_path.glob("*.safetensors")):
        adapter_parameters, adapter_tensors, _ = scan_safetensors(adapter_path)
        adapter = {"parameterCount": adapter_parameters, "tensorCount": adapter_tensors}
    report = {
        "format": "private-model-weight-report",
        "version": 1,
        "model": key,
        "repository": spec["repository"],
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "architecture": read_architecture(directory),
        "parameterCount": parameter_count,
        "tensorCount": tensor_count,
        "tensors": tensors[:12],
        "adapter": adapter,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Wrote local weight metadata to " + str(output))
    print("No tensor payloads or user data were loaded.")


def load_training_records(path):
    data_path = Path(path).expanduser()
    if not data_path.is_file():
        raise RuntimeError("Training data file does not exist: " + str(data_path))
    suffix = data_path.suffix.lower()
    if suffix not in (".txt", ".jsonl"):
        raise RuntimeError("Training data must be a local .txt or .jsonl file.")
    size = data_path.stat().st_size
    if size > MAX_DATA_BYTES:
        raise RuntimeError("Training file exceeds the 5 MiB safety limit.")
    try:
        content = data_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise RuntimeError("Could not read training data as UTF-8: " + str(error)) from error
    if len(content) > MAX_DATA_CHARS:
        raise RuntimeError("Training text exceeds the 2,000,000-character safety limit.")
    records = []
    if suffix == ".txt":
        text = content.strip()
        if text:
            records.append(text)
    else:
        for line_number, line in enumerate(content.splitlines(), 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError("Invalid JSONL at line " + str(line_number) + ": " + str(error)) from error
            text = None
            if isinstance(item, str):
                text = item
            elif isinstance(item, dict):
                for field in ("text", "content"):
                    if isinstance(item.get(field), str):
                        text = item[field]
                        break
                if text is None and isinstance(item.get("messages"), list):
                    parts = []
                    for message in item["messages"]:
                        if isinstance(message, dict) and isinstance(message.get("content"), str):
                            parts.append(message["content"])
                    if parts:
                        text = "\n".join(parts)
            if not isinstance(text, str) or not text.strip():
                raise RuntimeError(
                    "JSONL line " + str(line_number)
                    + " must be a string or an object with string text/content or messages[].content."
                )
            records.append(text.strip())
            if len(records) > MAX_RECORDS:
                raise RuntimeError("Training data exceeds the 10,000-record safety limit.")
    if not records:
        raise RuntimeError("Training data contains no non-empty text records.")
    return records


def check_training_resources(key):
    required_ram = model_spec(key)["minimum_ram"] * GIB
    ram = available_ram_bytes()
    if ram is not None and ram < required_ram:
        raise RuntimeError(
            "RAM guardrail: " + key + " requires at least "
            + str(model_spec(key)["minimum_ram"]) + " GiB total RAM; detected " + format_gib(ram) + "."
        )
    destination_parent = ADAPTERS_DIR
    available = free_bytes(destination_parent)
    if available < GIB:
        raise RuntimeError("Training requires at least 1 GiB free disk space for a local adapter; "
                           + format_gib(available) + " is available.")


def import_training_packages():
    missing = [name for name in REQUIRED_PACKAGES if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError(
            "Training/chat dependencies are missing: " + ", ".join(missing)
            + ". Install them in this Python environment; see the guide."
        )
    try:
        import torch
        from peft import LoraConfig, PeftModel, get_peft_model
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            DataCollatorForLanguageModeling,
            Trainer,
            TrainingArguments,
        )
    except Exception as error:
        raise RuntimeError("Could not import local training dependencies: " + str(error)) from error
    return {
        "torch": torch,
        "LoraConfig": LoraConfig,
        "PeftModel": PeftModel,
        "get_peft_model": get_peft_model,
        "AutoModelForCausalLM": AutoModelForCausalLM,
        "AutoTokenizer": AutoTokenizer,
        "DataCollatorForLanguageModeling": DataCollatorForLanguageModeling,
        "Trainer": Trainer,
        "TrainingArguments": TrainingArguments,
    }


def load_local_model(packages, directory):
    tokenizer = load_local_tokenizer(packages, directory)
    model = packages["AutoModelForCausalLM"].from_pretrained(
        str(directory),
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=True,
    )
    return tokenizer, model


def load_local_tokenizer(packages, directory):
    return packages["AutoTokenizer"].from_pretrained(
        str(directory), local_files_only=True, trust_remote_code=False
    )


class TokenizedRecords:
    def __init__(self, tokenizer, records, max_chunks):
        self.items = []
        token_stream = []
        separator = getattr(tokenizer, "eos_token_id", None)
        for text in records:
            encoded = tokenizer(
                text,
                truncation=False,
                add_special_tokens=True,
            )
            input_ids = encoded.get("input_ids")
            if not isinstance(input_ids, (list, tuple)):
                raise RuntimeError("Tokenizer did not return a complete input_ids sequence.")
            if input_ids:
                token_stream.extend(input_ids)
                if separator is not None and input_ids[-1] != separator:
                    token_stream.append(separator)
            chunk_count = (len(token_stream) + MAX_SEQUENCE_LENGTH - 1) // MAX_SEQUENCE_LENGTH
            if chunk_count > max_chunks:
                raise RuntimeError(
                    "Training input tokenizes to more than " + str(max_chunks)
                    + " chunks of " + str(MAX_SEQUENCE_LENGTH) + " tokens for --steps. "
                    + "Increase --steps (up to " + str(MAX_STEPS)
                    + "), or reduce/curate the input; no training was started."
                )
        if len(token_stream) < 2:
            raise RuntimeError(
                "Training input contains fewer than 2 tokens; add more text so causal-language-model "
                "training has at least one next-token target."
            )
        for start in range(0, len(token_stream), MAX_SEQUENCE_LENGTH):
            chunk = token_stream[start:start + MAX_SEQUENCE_LENGTH]
            self.items.append(chunk)
        if len(self.items) > 1 and len(self.items[-1]) == 1:
            if len(self.items[-2]) <= 2:
                raise RuntimeError("Could not safely form a trainable final token chunk.")
            self.items[-1].insert(0, self.items[-2].pop())
        self.items = [{"input_ids": chunk} for chunk in self.items]
        if not self.items:
            raise RuntimeError("Tokenizer produced no training tokens from the supplied data.")

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        return self.items[index]


def command_train(args):
    set_offline_environment()
    key = args.model
    model_spec(key)
    if args.steps < 1 or args.steps > MAX_STEPS:
        raise RuntimeError("Training steps must be between 1 and " + str(MAX_STEPS) + ".")
    directory = check_local_model(key)
    verify_shard_index(directory)
    check_training_resources(key)
    destination = adapter_directory(key)
    if destination.is_symlink():
        raise RuntimeError("Refusing to replace a symlink at the local adapter path: " + str(destination))
    if destination.exists() and not args.overwrite:
        raise RuntimeError(
            "A local adapter already exists at " + str(destination)
            + ". It was left unchanged. Use --overwrite only if you intend to replace it."
        )
    packages = import_training_packages()
    records = load_training_records(args.data)
    torch = packages["torch"]
    tokenizer = load_local_tokenizer(packages, directory)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    dataset = TokenizedRecords(
        tokenizer, records, max_chunks=args.steps * GRADIENT_ACCUMULATION_STEPS
    )
    base_model = packages["AutoModelForCausalLM"].from_pretrained(
        str(directory),
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=True,
    )
    target_modules = ["q_proj", "v_proj"]
    try:
        lora_model = packages["get_peft_model"](
            base_model,
            packages["LoraConfig"](
                task_type="CAUSAL_LM",
                r=8,
                lora_alpha=16,
                lora_dropout=0.05,
                target_modules=target_modules,
            ),
        )
    except Exception as error:
        raise RuntimeError(
            "Could not attach LoRA to the local model's q_proj/v_proj modules. "
            "This model architecture is not supported by this preset: " + str(error)
        ) from error
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=key + "-staging-", dir=str(destination.parent)))
    training_tmp = tempfile.TemporaryDirectory(prefix=key + "-trainer-")
    try:
        options = {
            "output_dir": training_tmp.name,
            "max_steps": args.steps,
            "per_device_train_batch_size": 1,
            "gradient_accumulation_steps": GRADIENT_ACCUMULATION_STEPS,
            "learning_rate": 2e-4,
            "logging_steps": max(1, min(10, args.steps)),
            "save_strategy": "no",
            "report_to": "none",
            "remove_unused_columns": False,
            "dataloader_pin_memory": False,
            "disable_tqdm": False,
        }
        trainer = packages["Trainer"](
            model=lora_model,
            args=packages["TrainingArguments"](**options),
            train_dataset=dataset,
            data_collator=packages["DataCollatorForLanguageModeling"](tokenizer=tokenizer, mlm=False),
        )
        print(
            "Training locally with offline flags; data file content is used only in this process. "
            "Base weights will not be saved or changed."
        )
        trainer.train()
        lora_model.save_pretrained(str(staging), safe_serialization=True)
        if not list(staging.glob("*.safetensors")) or not (staging / "adapter_config.json").is_file():
            raise RuntimeError("PEFT did not produce a local safetensors LoRA adapter.")
        backup = None
        if destination.exists():
            if not args.overwrite:
                raise RuntimeError(
                    "A local adapter appeared at " + str(destination)
                    + " while training was in progress; it was left unchanged."
                )
            if destination.is_symlink() or not destination.is_dir():
                raise RuntimeError("Refusing to replace a non-directory or symlink adapter path: " + str(destination))
            backup = Path(tempfile.mkdtemp(prefix=key + "-backup-", dir=str(destination.parent)))
            backup.rmdir()
            os.replace(str(destination), str(backup))
        try:
            os.replace(str(staging), str(destination))
        except OSError as error:
            if backup is not None and backup.exists():
                try:
                    os.replace(str(backup), str(destination))
                except OSError as restore_error:
                    raise RuntimeError(
                        "Could not install the new adapter and could not restore the previous adapter. "
                        "The previous adapter remains at " + str(backup) + "; install error: "
                        + str(error) + "; restore error: " + str(restore_error)
                    ) from error
            raise RuntimeError("Could not install the new adapter; previous adapter was restored: " + str(error)) from error
        if backup is not None:
            try:
                if backup.is_dir() and not backup.is_symlink():
                    shutil.rmtree(backup)
                else:
                    backup.unlink()
            except OSError as error:
                print("Warning: new adapter is installed, but the previous adapter backup remains at "
                      + str(backup) + ": " + str(error), file=sys.stderr)
    finally:
        training_tmp.cleanup()
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
    print("LoRA adapter saved locally to " + str(destination))
    print("The original base model files were left unchanged.")


def generation_device(torch):
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def generate_text(model, tokenizer, prompt, torch):
    if getattr(tokenizer, "chat_template", None):
        formatted = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True,
        )
    else:
        formatted = prompt
    inputs = tokenizer(formatted, return_tensors="pt")
    device = generation_device(torch)
    model.to(device)
    inputs = {name: tensor.to(device) for name, tensor in inputs.items()}
    model.eval()
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=160,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = output[0][inputs["input_ids"].shape[-1]:]
    return tokenizer.decode(generated, skip_special_tokens=True)


def command_chat(args):
    set_offline_environment()
    key = args.model
    directory = check_local_model(key)
    verify_shard_index(directory)
    packages = import_training_packages()
    adapter_path = adapter_directory(key)
    if args.adapter and not (adapter_path / "adapter_config.json").is_file():
        raise RuntimeError(
            "No local LoRA adapter found at " + str(adapter_path)
            + ". Train one first with `python private-model.py train --model " + key + " --data PATH`."
        )
    tokenizer, base_model = load_local_model(packages, directory)
    print("Base model (local, no adapter):")
    print(generate_text(base_model, tokenizer, args.prompt, packages["torch"]))
    if args.adapter:
        try:
            adapted_model = packages["PeftModel"].from_pretrained(
                base_model, str(adapter_path), is_trainable=False
            )
        except Exception as error:
            raise RuntimeError("Could not load the local LoRA adapter: " + str(error)) from error
        print("\nLoRA adapter comparison:")
        print(generate_text(adapted_model, tokenizer, args.prompt, packages["torch"]))
    print("\nGeneration used local files only; hosted services and network access are disabled.")


def product_parser():
    parser = argparse.ArgumentParser(
        description="Private, local-only model download, metadata inspection, LoRA training, and chat."
    )
    parser.add_argument("--self-test", action="store_true", help="run standard-library-only self-tests")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.required = False
    doctor = subparsers.add_parser("doctor", help="check Python, optional packages, RAM, and paths")
    doctor.set_defaults(handler=command_doctor)
    download = subparsers.add_parser("download", help="explicitly download one curated public model")
    download.add_argument("--model", required=True, choices=sorted(MODELS))
    download.set_defaults(handler=command_download)
    inspect_parser = subparsers.add_parser("inspect", help="inspect local safetensors headers")
    inspect_parser.add_argument("--model", required=True, choices=sorted(MODELS))
    inspect_parser.add_argument("--output", required=True)
    inspect_parser.set_defaults(handler=command_inspect)
    train = subparsers.add_parser("train", help="locally train a LoRA adapter from .txt or .jsonl")
    train.add_argument("--model", required=True, choices=sorted(MODELS))
    train.add_argument("--data", required=True)
    train.add_argument("--steps", type=int, default=30)
    train.add_argument("--overwrite", action="store_true", help="replace an existing local adapter after successful training")
    train.set_defaults(handler=command_train)
    chat = subparsers.add_parser("chat", help="chat with a local base model and optionally its adapter")
    chat.add_argument("--model", required=True, choices=sorted(MODELS))
    chat.add_argument("--prompt", required=True)
    chat.add_argument("--adapter", action="store_true", help="also compare generation using the local LoRA adapter")
    chat.set_defaults(handler=command_chat)
    return parser


def run_self_tests():
    import unittest

    class PrivateModelTests(unittest.TestCase):
        def test_allowlist_is_exact(self):
            self.assertEqual(
                set(MODELS),
                {"smollm2-135m", "qwen2.5-0.5b", "qwen2.5-1.5b"},
            )
            with self.assertRaises(RuntimeError):
                model_spec("some-other-model")

        def test_roles(self):
            self.assertEqual(tensor_role("model.embed_tokens.weight"), "embedding")
            self.assertEqual(tensor_role("layers.0.self_attn.q_proj.weight"), "attention")
            self.assertEqual(tensor_role("layers.0.mlp.up_proj.weight"), "feed_forward")
            self.assertEqual(tensor_role("model.norm.weight"), "normalization")

        def test_header_metadata_without_tensor_payload(self):
            import tempfile

            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "tiny.safetensors"
                header = json.dumps({
                    "weight": {"dtype": "F32", "shape": [2, 3], "data_offsets": [0, 24]},
                    "__metadata__": {"format": "pt"},
                }).encode("utf-8")
                path.write_bytes(struct.pack("<Q", len(header)) + header)
                self.assertEqual(scan_safetensors(Path(temp))[:2], (6, 1))

        def test_records_parser_is_bounded_and_local(self):
            import tempfile

            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "sample.jsonl"
                path.write_text('{"text":"one"}\n{"messages":[{"role":"user","content":"two"}]}\n', encoding="utf-8")
                self.assertEqual(load_training_records(path), ["one", "two"])

        def test_all_text_is_chunked_and_overflow_is_rejected(self):
            class FakeTokenizer:
                eos_token_id = 0

                def __init__(self):
                    self.calls = []

                def __call__(self, text, **kwargs):
                    self.calls.append(kwargs)
                    return {"input_ids": [ord(character) + 1 for character in text]}

            tokenizer = FakeTokenizer()
            records = ["a" * 600, "later paragraph ♞"]
            dataset = TokenizedRecords(tokenizer, records, max_chunks=3)
            token_ids = [
                token
                for item in dataset.items
                for token in item["input_ids"]
            ]
            self.assertIn(ord("♞") + 1, token_ids)
            self.assertTrue(all(call.get("truncation") is False for call in tokenizer.calls))
            self.assertGreater(len(dataset), 1)

            tiny_tail = TokenizedRecords(FakeTokenizer(), ["x" * 512], max_chunks=2)
            self.assertEqual([len(item["input_ids"]) for item in tiny_tail.items], [511, 2])

            with self.assertRaisesRegex(RuntimeError, "Increase --steps"):
                TokenizedRecords(FakeTokenizer(), ["y" * 513], max_chunks=1)

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PrivateModelTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv=None):
    parser = product_parser()
    args = parser.parse_args(argv)
    if args.self_test:
        return run_self_tests()
    if not getattr(args, "command", None):
        parser.print_help()
        return 0
    try:
        args.handler(args)
    except (RuntimeError, OSError, ValueError) as error:
        print("Error: " + str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())