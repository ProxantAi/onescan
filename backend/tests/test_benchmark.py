from benchmark import summarize


def test_synthetic_and_rejected_scans_do_not_enter_accuracy_mae():
    rows = []
    for kind, accepted, hr in (("synthetic", True, 72), ("human", True, 74), ("human", False, None)):
        rows.append({"capture_kind": kind, "reference_bpm": 70,
                     "response": {"results": [{"engine": "test", "accepted": accepted,
                                                "heart_rate_bpm": hr, "processing_seconds": 1}]}})
    summary = summarize(rows)["test"]
    assert summary["human_reference_pairs"] == 1
    assert summary["mae_bpm"] == 4
    assert summary["scans"] == 3
    assert summary["rejected"] == 1
