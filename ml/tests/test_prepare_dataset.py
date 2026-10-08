import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "training"))

import prepare_dataset as prep


def test_maps_cghd_labels() -> None:
    assert prep.map_label("resistor") == "resistor"
    assert prep.map_label("capacitor.polarized") == "capacitor"  # by base name
    assert prep.map_label("voltage.dc") == "voltage_source"
    assert prep.map_label("voltage.ac") == "other"
    assert prep.map_label("gnd") == "ground"
    assert prep.map_label("transistor.bjt") == "other"
    assert prep.map_label("text") == "text"
    assert prep.map_label("explanatory") is None


VOC = """<annotation>
  <filename>{name}.jpg</filename>
  <object><name>resistor</name><bndbox><xmin>10</xmin><ymin>20</ymin><xmax>50</xmax><ymax>40</ymax></bndbox></object>
  <object><name>explanatory</name><bndbox><xmin>1</xmin><ymin>1</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
  <object><name>transistor.bjt</name><bndbox><xmin>60</xmin><ymin>60</ymin><xmax>90</xmax><ymax>95</ymax></bndbox></object>
</annotation>"""


def make_cghd(root: Path, drafters: int, per_drafter: int) -> None:
    import cv2
    import numpy as np

    for d in range(drafters):
        for i in range(per_drafter):
            folder = root / f"drafter_{d}"
            (folder / "images").mkdir(parents=True, exist_ok=True)
            (folder / "annotations").mkdir(exist_ok=True)
            name = f"C{d}_D{i}_P1"
            cv2.imwrite(str(folder / "images" / f"{name}.jpg"), np.full((100, 200, 3), 255, np.uint8))
            (folder / "annotations" / f"{name}.xml").write_text(VOC.format(name=name))


def test_reads_voc_and_splits_by_drafter(tmp_path: Path) -> None:
    make_cghd(tmp_path / "cghd", drafters=10, per_drafter=3)
    counts: Counter[str] = Counter()
    samples = prep.read_cghd(tmp_path / "cghd", counts)
    assert len(samples) == 30
    assert counts["explanatory -> None"] == 30
    assert [b[0] for b in samples[0].boxes] == [0, 9]  # resistor, other; explanatory dropped

    splits = prep.split_by_drafter(samples, seed=0, val=0.2, test=0.2)
    drafters = {split: {s.drafter for s in items} for split, items in splits.items()}
    assert drafters["train"].isdisjoint(drafters["test"]) and drafters["train"].isdisjoint(drafters["val"])
    assert drafters["val"].isdisjoint(drafters["test"])
    assert len(drafters["test"]) == 2 and len(drafters["val"]) == 2

    prep.write_split(splits["test"], tmp_path / "yolo", "test")
    labels = sorted((tmp_path / "yolo/labels/test").glob("*.txt"))
    assert len(labels) == 6
    first = labels[0].read_text().splitlines()[0].split()
    assert first == ["0", "0.150000", "0.300000", "0.200000", "0.200000"]
