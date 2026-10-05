"""Bound EfficientPhys activation memory while preserving temporal group boundaries.

Run on the server with its original API source path. A backup is created before
the exact, known inference block is replaced. Model weights/preprocessing stay
unchanged. The last input of each batch is the next real frame for torch.diff.
"""
from pathlib import Path
import argparse
import shutil

ORIGINAL = '''        last = tensor[-1:].repeat(1, 1, 1, 1)
        tensor = torch.cat([tensor, last], dim=0)

        preds = []
        with torch.no_grad():
            batch = tensor.to(self.device)
            out = model(batch)
            preds.append(out.cpu().numpy().flatten())

        return np.concatenate(preds)[:n]'''

REPLACEMENT = '''        # Keep whole-video standardization and TSM groups unchanged. Bound
        # convolution activations instead of running up to 1800 frames at once.
        preds = []
        batch_frames = base_len * 8
        with torch.no_grad():
            for start in range(0, n, batch_frames):
                end = min(start + batch_frames, n)
                if end < n:
                    batch = tensor[start:end + 1]
                else:
                    batch = torch.cat([tensor[start:end], tensor[-1:]], dim=0)
                out = model(batch.to(self.device).contiguous())
                preds.append(out.cpu().numpy().flatten())

        return np.concatenate(preds)[:n]'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    source = args.source.read_text()
    if REPLACEMENT in source:
        print("Bounded inference is already installed")
        return
    if source.count(ORIGINAL) != 1:
        raise SystemExit("Original inference block differs; inspect before patching")
    backup = args.source.with_suffix(".py.before-onescan-batches")
    if backup.exists():
        raise SystemExit("Backup already exists; inspect before patching")
    shutil.copy2(args.source, backup)
    args.source.write_text(source.replace(ORIGINAL, REPLACEMENT))
    print(f"Patched {args.source}; backup {backup}")


if __name__ == "__main__":
    main()
