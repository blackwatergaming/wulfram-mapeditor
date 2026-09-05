"""Run with: python -m unittest discover -s tests -p test_asset_extraction.py"""
import importlib.util
from pathlib import Path
import struct
import sys
import unittest

spec = importlib.util.spec_from_file_location("extract_wulfram_assets", Path(__file__).resolve().parents[1] / "tools/extract_wulfram_assets.py")
extractor = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extractor
spec.loader.exec_module(extractor)


class BitmapDecodeTests(unittest.TestCase):
    palette = [(i, (i * 2) % 256, 255 - i) for i in range(256)]

    def test_full_mip_follows_all_smaller_levels(self):
        full = bytes(range(16))
        for kind in (3, 0x83):
            payload = struct.pack("<BH", kind, 2) + bytes([230, 231, 232, 233, 234]) + full
            image = extractor.decode_bitmap(payload, self.palette)
            self.assertEqual(image.size, (4, 4))
            self.assertEqual(list(image.get_flattened_data()), [(*self.palette[i], 255) for i in full])

    def test_one_pixel_mip_and_plain_bitmap_headers(self):
        image = extractor.decode_bitmap(struct.pack("<BH", 3, 0) + b"\x07", self.palette)
        self.assertEqual(image.getpixel((0, 0)), (*self.palette[7], 255))
        image = extractor.decode_bitmap(struct.pack("<BHHHH", 1, 2, 1, 3, 4) + b"\x00\x07", self.palette, transparent=True)
        self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(image.getpixel((1, 0)), (*self.palette[7], 255))

    def test_truncated_mip_chain_is_rejected_even_when_first_level_sized_slice_fits(self):
        for payload in (b"", b"\x03\x02", struct.pack("<BH", 3, 2) + bytes(16)):
            with self.assertRaises(ValueError):
                extractor.decode_bitmap(payload, self.palette)


if __name__ == "__main__":
    unittest.main()
