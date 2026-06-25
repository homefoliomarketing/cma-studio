"""
Tests for the PDF parsing DoS caps (cma/media.py) — these are the limits that
stop a hostile or huge MLS PDF from exhausting server memory.

Run:  python -m unittest discover -s tests
"""
import unittest

import fitz
from cma import media, parser


def make_pdf(pages=1, width=612, height=792):
    doc = fitz.open()
    for i in range(pages):
        doc.new_page(width=width, height=height).insert_text((72, 72), f"Page {i + 1}")
    return doc


class ParserCapTests(unittest.TestCase):
    def test_render_pages_capped(self):
        # A PDF with far more pages than the cap must only render up to _MAX_PAGES.
        doc = make_pdf(pages=media._MAX_PAGES + 25)
        try:
            uris = media.render_pages_b64(doc)
            self.assertLessEqual(len(uris), media._MAX_PAGES)
            self.assertEqual(len(uris), media._MAX_PAGES)
        finally:
            doc.close()

    def test_normal_pdf_renders_all_pages(self):
        doc = make_pdf(pages=3)
        try:
            self.assertEqual(len(media.render_pages_b64(doc)), 3)
        finally:
            doc.close()

    def test_safe_matrix_caps_huge_page(self):
        # A page with an enormous MediaBox must be scaled down so the rendered
        # pixel count stays within the cap (can't allocate a giant pixmap).
        doc = make_pdf(pages=1, width=20000, height=20000)
        try:
            page = doc[0]
            mat = media._safe_matrix(page, zoom=2.0)
            pixels = (page.rect.width * mat.a) * (page.rect.height * mat.d)
            self.assertLessEqual(pixels, media._MAX_PIXELS * 1.02)
        finally:
            doc.close()

    def test_safe_matrix_leaves_normal_page_untouched(self):
        doc = make_pdf(pages=1)  # standard letter size
        try:
            mat = media._safe_matrix(doc[0], zoom=2.0)
            self.assertAlmostEqual(mat.a, 2.0, places=6)
        finally:
            doc.close()

    def test_too_big_helper(self):
        # info tuple: (xref, smask, width, height, ...)
        self.assertTrue(media._too_big((1, 0, 99999, 99999)))
        self.assertFalse(media._too_big((1, 0, 800, 600)))
        self.assertFalse(media._too_big(("bad", "data")))  # malformed → not "too big"

    def test_parse_doc_returns_dict(self):
        doc = make_pdf(pages=1)
        try:
            data = parser.parse_doc(doc)
            self.assertIsInstance(data, dict)
        finally:
            doc.close()


if __name__ == "__main__":
    unittest.main()
