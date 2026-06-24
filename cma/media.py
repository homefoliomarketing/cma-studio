"""
Pull visual assets out of an uploaded MLS PDF:

  * extract_photos  -> the property photos (large embedded images, e.g. the
                       photo pages), saved as JPEGs for the styled report.
  * render_pages    -> every page rendered to a JPEG image, so the report can
                       attach the ORIGINAL pages (data sheet + photos) as-is.

Both are best-effort and never raise on a single bad image; the realtor can
always add/replace photos by hand.
"""

import io
import base64
import fitz  # PyMuPDF

# Ignore small images (logos, board badges, map pins, icons).
_MIN_W = 200
_MIN_H = 160
_MAX_PHOTOS = 40


def _pix_to_jpeg(pix, quality=82):
    if pix.n - pix.alpha >= 4:        # CMYK -> RGB
        pix = fitz.Pixmap(fitz.csRGB, pix)
    elif pix.alpha:                    # drop alpha for JPEG
        pix = fitz.Pixmap(pix, 0)
    return pix.tobytes("jpeg", jpg_quality=quality)


def extract_photos(doc, out_dir, prefix="photo"):
    """Save large embedded images as JPEGs. Returns a list of filenames."""
    names = []
    seen = set()
    for page in doc:
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.width < _MIN_W or pix.height < _MIN_H:
                    continue
                data = _pix_to_jpeg(pix)
            except Exception:
                continue
            fn = f"{prefix}_{len(names) + 1}.jpg"
            with open(f"{out_dir}/{fn}", "wb") as f:
                f.write(data)
            names.append(fn)
            if len(names) >= _MAX_PHOTOS:
                return names
    return names


def render_pages(doc, out_dir, prefix="page", zoom=2.0):
    """Render each page to a JPEG. Returns a list of filenames (page order)."""
    names = []
    mat = fitz.Matrix(zoom, zoom)
    for i, page in enumerate(doc):
        try:
            pix = page.get_pixmap(matrix=mat)
            data = _pix_to_jpeg(pix, quality=80)
        except Exception:
            continue
        fn = f"{prefix}_{i + 1}.jpg"
        with open(f"{out_dir}/{fn}", "wb") as f:
            f.write(data)
        names.append(fn)
    return names


def extract_photos_b64(doc):
    """Like extract_photos, but return base64 JPEG data URIs instead of files."""
    uris = []
    seen = set()
    for page in doc:
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.width < _MIN_W or pix.height < _MIN_H:
                    continue
                data = _pix_to_jpeg(pix)
            except Exception:
                continue
            b64 = base64.b64encode(data).decode()
            uris.append(f"data:image/jpeg;base64,{b64}")
            if len(uris) >= _MAX_PHOTOS:
                return uris
    return uris


def render_pages_b64(doc, zoom=2.0):
    """Like render_pages, but return base64 JPEG data URIs (page order)."""
    uris = []
    mat = fitz.Matrix(zoom, zoom)
    for page in doc:
        try:
            pix = page.get_pixmap(matrix=mat)
            data = _pix_to_jpeg(pix, quality=80)
        except Exception:
            continue
        b64 = base64.b64encode(data).decode()
        uris.append(f"data:image/jpeg;base64,{b64}")
    return uris
