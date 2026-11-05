#!/usr/bin/env python3
"""Import selected, measured ICP-OES channels without adding inferred standards.

Usage:
    python3 scripts/import-calibration.py path/to/export.csv
    python3 scripts/import-calibration.py path/to/export.csv --output profiles.json

Only Python's standard library is required. The user confirmed that the sample
``Mixture 0.1 ppm`` belongs to Mixture I and that all modes used 5 s exposure.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from pathlib import Path


SELECTED_ELEMENTS = {"Cd", "Cu", "Zn", "Mg", "Ca", "P", "Ti", "Sb", "Pb", "Fe"}
MIXTURE_II = {"Ti", "V", "Sn", "Sb", "Hg"}
MIXTURE_III = {"Ca", "Na", "Mg", "K", "P", "S", "Si"}
CHANNEL_PATTERN = re.compile(
    r"^(?P<element>[A-Z][a-z]?) (?P<wavelength>\d+\.\d+) "
    r"\(Aqueous-(?P<view>Axial|Radial)-(?P<mode>iFR|eUV)\)$"
)
STANDARD_PATTERN = re.compile(
    r"^mixture (?P<mixture>III|II|I) (?P<concentration>\d+(?:\.\d+)?) ppm(?: hcl 1%)?$",
    re.IGNORECASE,
)
BLANK_LABEL = "blank icp HNO3 1%"
AMBIGUOUS_LABEL = "Mixture 0.1 ppm"
CATEGORIES = ("Intensity average", "Intensity SD", "Intensity RSD")


def number(value: str, context: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Nonfinite measurement in {context}")
    return result


def mixture_for(element: str) -> str:
    if element in MIXTURE_II:
        return "II"
    if element in MIXTURE_III:
        return "III"
    return "I"


def read_export(path: Path) -> tuple[list[str], dict[str, dict[str, list[str]]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if not rows or rows[0][:2] != ["Category", "Label"]:
        raise ValueError("Expected a Qtegra export beginning with Category,Label")
    headers = rows[0]
    samples: dict[str, dict[str, list[str]]] = {}
    for line_number, row in enumerate(rows[1:], start=2):
        if not row or not any(row):
            continue
        if len(row) != len(headers):
            raise ValueError(f"CSV row {line_number} has {len(row)} fields; expected {len(headers)}")
        category, label = row[:2]
        if category not in CATEGORIES:
            raise ValueError(f"Unsupported category {category!r} at row {line_number}")
        sample = samples.setdefault(label, {})
        if category in sample:
            raise ValueError(f"Duplicate {category!r} row for {label!r}")
        sample[category] = row
    for label, sample in samples.items():
        if set(sample) != set(CATEGORIES):
            raise ValueError(f"Incomplete mean/SD/RSD rows for {label!r}")
    if BLANK_LABEL not in samples:
        raise ValueError(f"Missing calibration blank {BLANK_LABEL!r}")
    return headers, samples


def import_profiles(path: Path) -> dict:
    headers, samples = read_export(path)
    profiles = []
    for column, header in enumerate(headers[2:], start=2):
        channel = CHANNEL_PATTERN.fullmatch(header)
        if channel is None:
            raise ValueError(f"Unsupported channel header {header!r}")
        metadata = channel.groupdict()
        element = metadata["element"]
        if element not in SELECTED_ELEMENTS:
            continue
        mixture = mixture_for(element)
        points = []
        for label, sample in samples.items():
            if label == BLANK_LABEL:
                concentration = 0.0
            else:
                if label == AMBIGUOUS_LABEL:
                    if mixture != "I":
                        continue
                    concentration = 0.1
                else:
                    standard = STANDARD_PATTERN.fullmatch(label)
                    if standard is None or standard["mixture"].upper() != mixture:
                        continue
                    concentration = float(standard["concentration"])
            mean = number(sample["Intensity average"][column], f"{header}: {label} mean")
            sd = number(sample["Intensity SD"][column], f"{header}: {label} SD")
            if sd < 0:
                raise ValueError(f"Negative SD for {header}: {label}")
            rsd_cell = sample["Intensity RSD"][column].strip()
            reported_rsd = number(rsd_cell, f"{header}: {label} RSD") if rsd_cell else None
            points.append({
                "concentration": concentration,
                "mean": mean,
                "sd": sd,
                "reportedRsd": reported_rsd,
                "label": label,
            })
        points.sort(key=lambda point: point["concentration"])
        concentrations = [point["concentration"] for point in points]
        if len(concentrations) != len(set(concentrations)):
            raise ValueError(f"Duplicate known concentrations for {header}")
        positive = [point for point in points if point["concentration"] > 0]
        if not points or points[0]["concentration"] != 0 or len(positive) < 2:
            raise ValueError(f"Blank and at least two positive standards required for {header}")
        baseline = points[0]["mean"]
        first, last = positive[0], positive[-1]
        slope = (first["mean"] - baseline) / first["concentration"]
        if slope <= 0 or last["mean"] == 0:
            raise ValueError(f"Positive reference sensitivity and nonzero high signal required for {header}")
        compression = ((last["mean"] - baseline) / last["concentration"]) / slope
        wavelength = float(metadata["wavelength"])
        profile_id = "-".join((
            element.lower(),
            f"{wavelength:.3f}".replace(".", ""),
            metadata["view"].lower(),
            metadata["mode"].lower(),
        ))
        response = (
            "Measured high-level response is compressed relative to the lowest measured positive standard; "
            "the export does not establish detector saturation."
            if compression < 0.90 else
            "No greater than 10% endpoint response compression is observed across the measured positive standards."
        )
        profiles.append({
            "id": profile_id,
            "element": element,
            "wavelength": wavelength,
            "view": metadata["view"],
            "mode": metadata["mode"],
            "mixture": mixture,
            "points": points,
            "baseline": baseline,
            "referenceSlope": slope,
            "referenceRsd": last["sd"] / abs(last["mean"]),
            "referenceBlankSd": points[0]["sd"],
            "measuredMax": last["concentration"],
            "measuredMin": first["concentration"],
            "compressionRatio": compression,
            "description": (
                f"{header}; mixture {mixture}, measured positive range "
                f"{first['concentration']:g}–{last['concentration']:g} ppm. {response}"
            ),
        })
    if {profile["element"] for profile in profiles} != SELECTED_ELEMENTS:
        raise ValueError("One or more selected elements are missing from the export")
    if len({profile["id"] for profile in profiles}) != len(profiles):
        raise ValueError("Channel identifiers are not unique")
    return {
        "source": {
            "fileName": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "instrument": "Thermo iCAP PRO Duo ICP-OES",
            "referenceExposureSeconds": 5,
            "ambiguousLabelPolicy": "user confirmed 'Mixture 0.1 ppm' is Mixture I",
            "notes": [
                "Concentrations are assigned from explicit mixture labels and the user's element-to-mixture mapping.",
                "Mixture I: blank, 0.01, 0.1 and 1 ppm; Mixture II: blank, 0.05 and 0.1 ppm; Mixture III: blank, 25, 50 and 100 ppm.",
                "The user confirmed that the sample labelled 'Mixture 0.1 ppm' belongs to Mixture I; it is used only for Mixture I elements.",
                "Mixture II standards are labelled HCl 1%; the only exported blank is labelled HNO3 1%. Its baseline is retained with an acid-mismatch limitation.",
                "Means and SDs are exported measurements in cps. reportedRsd is the exported percentage; referenceRsd is a fractional SD/absolute mean at the highest known concentration.",
                "The user confirmed 5 s exposure for every mode. Raw replicates, replicate counts, and detector/subarray saturation flags are not present in this export.",
                "The user confirmed that the high-concentration Mg results were numeric and had no saturation flag in Qtegra. These measured values remain valid numeric inputs, not N/A or confirmed detector saturation.",
                "Endpoint response compression is empirical evidence of nonlinearity, not proof of pixel saturation or a universal cps limit.",
                "Channels for 10 starter elements are retained with their exact exported wavelengths, viewing geometries, and iFR/eUV modes.",
                "Only the exported concentration knots are measured; interpolation and extrapolation in the simulator are modelling assumptions.",
            ],
        },
        "profiles": profiles,
    }


def report(data: dict) -> str:
    source = data["source"]
    profiles = data["profiles"]
    lines = [
        "# Imported calibration data",
        "",
        f"Source: `{source['fileName']}`. Instrument: {source['instrument']}.",
        f"SHA-256: `{source['sha256']}`.",
        "",
        f"The starter dataset contains **{len(profiles)} measured channels for 10 elements**. "
        "The raw export remains outside the repository; the JSON retains only these channels and their relevant standards. "
        "Wavelengths and acquisition-mode names come directly from the header. For example, the exported Cd wavelength is 214.438 nm.",
        "",
        "## Standard assignment",
        "",
        "| Mixture | Selected elements | Retained positive standards (ppm) |",
        "| --- | --- | --- |",
        "| I | Cd, Cu, Zn, Pb, Fe | 0.01, 0.1, 1 |",
        "| II | Ti, Sb | 0.05, 0.1 |",
        "| III | Mg, Ca, P | 25, 50, 100 |",
        "",
        "Every profile also retains the measured `blank icp HNO3 1%` at zero concentration. "
        "The user confirmed that `Mixture 0.1 ppm` belongs to Mixture I; it is retained only for Mixture I elements. "
        "Signals in another mixture's rows are not assigned concentrations for the selected element, even when their intensity resembles a possible standard.",
        "",
        "Mixture II standards are labelled `HCL 1%`, whereas the only blank is labelled `HNO3 1%`. "
        "This blank is used transparently as the available baseline; matrix differences can affect the inferred sensitivity, especially at low concentrations.",
        "",
        "## Per-channel observations",
        "",
        "Sensitivity is `(mean at lowest positive standard − blank mean) / concentration`, in cps/ppm. "
        "The endpoint ratio is `(net cps/ppm at highest standard) / (net cps/ppm at lowest standard)`. "
        "A ratio below 0.90 is marked as observed compression. This screening threshold is descriptive and is not a validated linearity criterion. "
        "It does not identify where nonlinearity begins or prove detector saturation. A ratio above 0.90 does not establish a validated linear range.",
        "",
        "| Channel | Mixture | Measured positive range (ppm) | Reference sensitivity (cps/ppm) | Endpoint ratio | Observation |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ]
    for profile in profiles:
        label = f"{profile['element']} {profile['wavelength']:.3f} {profile['view']} {profile['mode']}"
        observation = "Response compression" if profile["compressionRatio"] < 0.90 else "No >10% endpoint compression"
        lines.append(
            f"| {label} | {profile['mixture']} | {profile['measuredMin']:g}–{profile['measuredMax']:g} "
            f"| {profile['referenceSlope']:,.3f} | {profile['compressionRatio']:.3f} | {observation} |"
        )
    lines.extend([
        "",
        "## Mg illustrates the measured differences",
        "",
        "All six Mg channels have the same three known positive concentrations. Strong Mg 280.270 Axial increases from about "
        "1.995 million cps at 25 ppm to 3.778 million cps at 100 ppm, well short of a fourfold increase. "
        "Weak Mg 279.079 Radial increases from about 3,561 to 13,967 cps, much closer to fourfold. "
        "These measurements support different response shapes and sensitivity rankings for those channels under this method. "
        "The user confirmed that the high-concentration Mg results remained numeric and had no saturation flag in Qtegra. "
        "They are retained as numeric measurements without invalid or N/A status. The observed compression is not confirmed detector saturation; "
        "these rows cannot distinguish self-absorption, other instrument effects, or matrix-dependent response.",
        "",
        "Mixture I contains three positive levels; Mixture II contains only two. Endpoint ratios compare net sensitivity "
        "at the retained levels, but the intermediate shape and the location of any nonlinear onset are not established. "
        "In particular, the Cd data stop at 1 ppm and provide no measured basis for saturation at 100 ppm.",
        "",
        "## Measurement and model boundary",
        "",
        "- Each JSON point is one exported mean, SD, and reported RSD percentage. Negative blank means are retained "
        "without clamping to zero.",
        "- `baseline` and `referenceBlankSd` are the exported blank mean and SD. `referenceSlope` uses the lowest known positive "
        "standard. `referenceRsd` is the highest known standard's SD divided by its absolute mean, as a fraction rather than a percentage.",
        "- The SD is the exported intensity SD. The file supplies no raw replicate values or replicate count; generated simulator "
        "replicates are synthetic and cannot reproduce an unknown original acquisition.",
        "- The user confirmed 5 s exposure for all modes. No exposure-dependent detector limit can be calibrated from these rows alone. "
        "The file contains numeric intensities throughout and supplies no N/A, peak-saturation, or adjacent-pixel saturation flags. "
        "Separately, the user confirmed that Qtegra did not flag the high-concentration Mg results as saturated.",
        "- Only the concentration knots listed above were measured. Smooth curves between them and predictions outside those "
        "ranges are educational model assumptions. No interpolation or extrapolation value is stored as a measured point.",
        "- Neither an endpoint ratio nor a shared cps threshold is a detector full-well measurement. "
        "Experimental exposure settings, saturation flags, and additional standards are needed to constrain such a model.",
        "",
        "## Reproduce",
        "",
        "```sh",
        "python3 scripts/import-calibration.py '/path/to/261028-29  CALIBRATION CPS for Simulator.csv'",
        "```",
        "",
        "The importer uses Python's standard library and rewrites `src/data/calibration-profiles.json` and this report deterministically. "
        "Use `--output` and `--report` to choose other destinations. It validates sample triplets, finite numeric data, "
        "nonnegative SD, unique known concentrations, exact channel-header structure, and unique profile identifiers.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="Qtegra intensity export")
    parser.add_argument("--output", type=Path, default=Path("src/data/calibration-profiles.json"))
    parser.add_argument("--report", type=Path, default=Path("docs/calibration-data-report.md"))
    arguments = parser.parse_args()
    data = import_profiles(arguments.csv)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(report(data), encoding="utf-8")
    print(f"Imported {len(data['profiles'])} measured channels into {arguments.output}")


if __name__ == "__main__":
    main()
