---
name: Curated private-model catalog
description: Why private fine-tuning supports a controlled model list rather than arbitrary repository IDs
---

Only advertise a model as trainable after validating its public access, local safetensors checkpoint format, architecture-specific LoRA modules, offline loading, and realistic laptop requirements. Keep a curated catalog rather than accepting arbitrary repository IDs as an apparent guarantee of support.

**Why:** The requested experience includes private data and actual weight adaptation, not just downloading an inference file. Remote model code, gated licenses, incompatible architectures, and underpowered laptops can make a generic "any model" command unsafe or misleading. The initial development environment did not validate real macOS/Windows fine-tuning.

**How to apply:** When expanding choices, distinguish fully tested trainable presets from unsupported or inspect-only checkpoints. Avoid claiming that library offline flags constitute a system firewall; suggest physically disconnecting for independent network isolation.

Pin curated downloads to checked revisions rather than silently following a changing upstream default branch. **Why:** Public access, model-card terms, and module layouts can change independently of the UI's fixed claims. **How to apply:** When adding or updating a preset, recheck its card license, access status, config, safetensors names and LoRA tensors at that revision; still tell users to review current terms themselves.