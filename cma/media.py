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
# Hostile/huge PDFs: cap how many pages we scan/render and the pixels we'll
# allocate for any single image, so one upload can't exhaust server memory.
# A real MLS sheet is a handful of pages; 40 is generous headroom.
_MAX_PAGES = 40
_MAX_PIXELS = 25_000_000  # ~25 megapixels per page/image


def _safe_matrix(page, zoom):
    """A render matrix that won't allocate an absurd pixmap. Caps the zoom so the
    rendered page can't exceed _MAX_PIXELS, so a page with a giant MediaBox can't
    OOM the process; normal pages render at the requested zoom unchanged."""
    rect = page.rect
    w = max(1.0, float(rect.width))
    h = max(1.0, float(rect.height))
    max_zoom = (_MAX_PIXELS / (w * h)) ** 0.5
    if max_zoom < zoom:
        zoom = max(0.05, max_zoom)  # tiny floor avoids a zero-size matrix
    return fitz.Matrix(zoom, zoom)


def _pix_to_jpeg(pix, quality=82):
    if pix.n - pix.alpha >= 4:        # CMYK -> RGB
        pix = fitz.Pixmap(fitz.csRGB, pix)
    elif pix.alpha:                    # drop alpha for JPEG
        pix = fitz.Pixmap(pix, 0)
    return pix.tobytes("jpeg", jpg_quality=quality)


def _too_big(info):
    """True if an embedded image's declared dimensions exceed the pixel cap, so
    we can skip it WITHOUT allocating the pixmap. info = get_images(full=True)
    tuple: (xref, smask, width, height, ...)."""
    try:
        return (int(info[2]) * int(info[3])) > _MAX_PIXELS
    except Exception:
        return False


def extract_photos(doc, out_dir, prefix="photo"):
    """Save large embedded images as JPEGs. Returns a list of filenames."""
    names = []
    seen = set()
    for pi, page in enumerate(doc):
        if pi >= _MAX_PAGES:
            break
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            if _too_big(info):
                continue
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
    for i, page in enumerate(doc):
        if i >= _MAX_PAGES:
            break
        try:
            pix = page.get_pixmap(matrix=_safe_matrix(page, zoom))
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
    for pi, page in enumerate(doc):
        if pi >= _MAX_PAGES:
            break
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            if _too_big(info):
                continue
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
    for i, page in enumerate(doc):
        if i >= _MAX_PAGES:
            break
        try:
            pix = page.get_pixmap(matrix=_safe_matrix(page, zoom))
            data = _pix_to_jpeg(pix, quality=80)
        except Exception:
            continue
        b64 = base64.b64encode(data).decode()
        uris.append(f"data:image/jpeg;base64,{b64}")
    return uris
