"""Evaluate labeled videos through the same API used by the UI.

CSV columns: id,video,reference_bpm,capture_kind (human or synthetic).
Only human captures with simultaneous reference readings enter reported MAE.
"""
import argparse
import csv
import json
from pathlib import Path
import statistics

import httpx


def summarize(rows):
    summary = {}
    for name in sorted({item["engine"] for row in rows for item in row["response"].get("results", [])}):
        entries = [(row, item) for row in rows for item in row["response"].get("results", []) if item["engine"] == name]
        accepted = [item for _, item in entries if item["accepted"]]
        errors = [abs(item["heart_rate_bpm"] - row["reference_bpm"]) for row, item in entries
                  if item["accepted"] and row["capture_kind"] == "human" and row["reference_bpm"] is not None]
        summary[name] = {"scans": len(entries), "accepted": len(accepted),
                         "rejected": len(entries) - len(accepted), "human_reference_pairs": len(errors),
                         "mae_bpm": round(statistics.mean(errors), 3) if errors else None,
                         "mean_processing_seconds": round(statistics.mean(item["processing_seconds"] for item in accepted), 3) if accepted else None}
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8001")
    parser.add_argument("--output", type=Path, default=Path("validation-results/benchmark.json"))
    args = parser.parse_args()
    rows = []
    with args.manifest.open(newline="") as manifest, httpx.Client(timeout=300) as client:
        for row in csv.DictReader(manifest):
            kind = row.get("capture_kind", "human")
            if kind not in ("human", "synthetic"):
                raise ValueError("capture_kind must be human or synthetic")
            reference = float(row["reference_bpm"]) if row.get("reference_bpm") else None
            path = (args.manifest.parent / row["video"]).resolve()
            data = {"selected": "compare"}
            if reference is not None:
                data["reference_bpm"] = str(reference)
            with path.open("rb") as video:
                response = client.post(f"{args.url.rstrip('/')}/analyze", data=data,
                                       files={"video": (path.name, video, "video/mp4")})
            response.raise_for_status()
            rows.append({"id": row["id"], "capture_kind": kind, "reference_bpm": reference, "response": response.json()})
            print(f"{row['id']}: accepted={sum(item['accepted'] for item in rows[-1]['response']['results'])}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output = {"samples": rows, "summary": summarize(rows),
              "note": "Synthetic fixtures are integration tests; they do not establish physiological accuracy."}
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(json.dumps(output["summary"], indent=2))


if __name__ == "__main__":
    main()
