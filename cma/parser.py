"""
MLS PDF reader for the CMA tool.

Tuned to the Paragon "Residential" one-page report layout (the format used by
the user's real estate board). It turns an uploaded MLS PDF into clean,
structured data the rest of the app can use.

Design notes:
- The report is a form: labels sit in fixed columns, values to their right.
- We read the words WITH their x/y positions, rebuild visual lines, then for
  each known label we grab the words that follow it until the next known label.
- Square footage and building age come from this MLS as RANGES (e.g. "2001-2500",
  "21-25"), so we expose low/high/mid and never silently invent an exact number.
- "Sold Price" is blank on active listings; we capture it when present and flag
  when it is missing so the UI can warn that a comp isn't a sold sale.
"""

import re
import sys
import json

import fitz  # PyMuPDF


# ---------------------------------------------------------------------------
# Known labels. Used both to locate values and to know where a value ENDS
# (a value runs until the next known label begins on the same line).
# ---------------------------------------------------------------------------

GRID_LABELS = [
    "List Price", "Status", "S.B. Comm", "Address", "City", "Legal Desc",
    "District", "Sub District", "Assessment $", "Annual Taxes $", "Closing Date",
    "List Date", "MLS #", "Type", "SubType", "Zoning", "Lot Size", "Acreage",
    "Fronting On", "Possession", "Waterfront", "Waterfront Name", "Sign Y/N",
    "Lockbox Y/N", "SPIS Y/N", "Survey Y/N", "Occup.", "# Bdrms AG", "# Bdrms BG",
    "# Full Baths", "# Half Baths", "Age", "Heat Cost $ / per",
    "Hydro Costs $ / Per", "Age (Building)", "Condo Fee", "Tax Year", "Land Type",
    "Local Imprv", "Improv Cost $", "Rental Equip", "SqFt", "Sold Price",
    "Firm Date", "Seller Name 1", "Seller Name 2", "Seller Name 3",
    "Seller Name 4", "List Office", "Selling Office", "List Agent",
    "Selling Agent", "Condo Locker #", "Condo Parking Spaces #",
    "Parking Space Ownership", "Conditions", "Escape Clause", "Chattel Included",
    "Fixtures Excluded", "Public Remarks", "Realtor Remarks",
    "Level", "Room", "Size", "Flooring",
]

FEATURE_LABELS = [
    "STYLE", "SERVICES AVAILABLE", "WATER/WELL", "SEWER/SEPTIC", "BASEMENT 1",
    "BASEMENT FINISH", "FOUNDATION", "EXTERIOR FINISH", "FEATURES INTERIOR",
    "FEATURES EXTERIOR", "HEATING TYPE", "HEATING SOURCE", "GARAGE TYPE/SIZE",
    "DRIVEWAY SIZE", "DRIVEWAY DETAILS",
]

ALL_LABELS = GRID_LABELS + FEATURE_LABELS
ALL_LABEL_TOKENS = sorted(
    ([t.lower() for t in lbl.split()] for lbl in ALL_LABELS),
    key=len, reverse=True,
)


def _starts_label(words_lower, j):
    """Return the token-length of the longest known label starting at index j."""
    for lt in ALL_LABEL_TOKENS:
        n = len(lt)
        if words_lower[j:j + n] == lt:
            return n
    return 0


def _cluster_lines(words, tol=3.5):
    """Group word tuples (x0,y0,x1,y1,text) into visual lines, left-to-right."""
    ws = sorted(words, key=lambda w: (w[1], w[0]))
    lines, cur, last_y = [], [], None
    for w in ws:
        if last_y is None or abs(w[1] - last_y) <= tol:
            cur.append(w)
        else:
            lines.append(sorted(cur, key=lambda t: t[0]))
            cur = [w]
        last_y = w[1]
    if cur:
        lines.append(sorted(cur, key=lambda t: t[0]))
    return lines


def _value_after(line, label, max_x=None):
    """In one line, find `label` and return the text after it up to the next label.

    `max_x` stops collection before a given x-position, so a value in one column
    does not bleed into a neighbouring column's wrapped text.
    """
    lw = [w[4].lower() for w in line]
    lt = [t.lower() for t in label.split()]
    n = len(lt)
    for i in range(len(lw) - n + 1):
        if lw[i:i + n] == lt:
            vals, j = [], i + n
            while j < len(line):
                if _starts_label(lw, j):
                    break
                if max_x is not None and line[j][0] >= max_x:
                    break
                vals.append(line[j][4])
                j += 1
            return " ".join(vals).strip()
    return None


def _find(lines, label, max_x=None):
    """First non-empty value for `label` across all lines."""
    for line in lines:
        v = _value_after(line, label, max_x)
        if v is not None and v != "":
            return v
    return None


def _line_with(lines, label):
    lt = [t.lower() for t in label.split()]
    n = len(lt)
    for line in lines:
        lw = [w[4].lower() for w in line]
        for i in range(len(lw) - n + 1):
            if lw[i:i + n] == lt:
                return line
    return None


def _ints(line):
    return [int(w[4]) for w in line if re.fullmatch(r"\d+", w[4])]


def _money(s):
    """'$2,990.00' or '599,900' -> 2990.0 / 599900.0; None if not parseable."""
    if not s:
        return None
    m = re.search(r"[\d,]+(?:\.\d+)?", s.replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _range(s):
    """'2001-2500' or '21-25' -> {'raw','low','high','mid'}; single number ok too."""
    if not s:
        return None
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", s)]
    if not nums:
        return {"raw": s, "low": None, "high": None, "mid": None}
    low, high = nums[0], nums[-1]
    return {"raw": s.strip(), "low": low, "high": high, "mid": round((low + high) / 2, 1)}


# A real room row has a size like "13 x 33.5" or a bath fixture count like "4pce".
# This pattern lets us keep genuine rooms and drop the seller/office/agent rows
# that sit just below the room table.
_ROOM_SIZE_RE = re.compile(r"^\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?$|^\d+\s*pce$", re.I)


def _rooms(lines):
    """Parse the Level/Room/Size/Flooring table (two side-by-side blocks)."""
    rooms = []
    # find the header row to know where the table starts vertically
    header = _line_with(lines, "Flooring")
    start_y = header[0][1] if header else 480
    bands = [  # (level, room, size, flooring) x-ranges for left and right blocks
        (0, 60, 110, 185, 300),
        (300, 345, 395, 470, 620),
    ]
    for line in lines:
        if not line or line[0][1] <= start_y:
            continue
        for lx, rx, sx, fx, ex in bands:
            level = " ".join(w[4] for w in line if lx <= w[0] < rx)
            room = " ".join(w[4] for w in line if rx <= w[0] < sx)
            size = " ".join(w[4] for w in line if sx <= w[0] < fx)
            floor = " ".join(w[4] for w in line if fx <= w[0] < ex)
            if room and _ROOM_SIZE_RE.match(size.strip()):
                rooms.append({"level": level, "room": room, "size": size, "flooring": floor})
    return rooms


def parse_pdf(path):
    """Parse an MLS PDF from a file path."""
    return parse_doc(fitz.open(path))


def parse_bytes(data):
    """Parse an MLS PDF from raw bytes (used for browser uploads)."""
    return parse_doc(fitz.open(stream=data, filetype="pdf"))


def parse_doc(doc):
    """Parse an already-open PyMuPDF document (page 1 is the MLS data sheet)."""
    page = doc[0]
    words = [(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text("words")]
    lines = _cluster_lines(words)
    full_text = page.get_text()

    bdrm_line = _line_with(lines, "# Bdrms AG")
    bath_line = _line_with(lines, "# Full Baths")
    beds = _ints(bdrm_line) if bdrm_line else []
    baths = _ints(bath_line) if bath_line else []

    sold_raw = _find(lines, "Sold Price")
    list_raw = _find(lines, "List Price")

    postal = re.search(r"[A-Z]\d[A-Z]\s?\d[A-Z]\d", full_text)

    # the City value sits to the left of the postal code with no label between
    # them, so strip a trailing postal code off the captured city text.
    city = _find(lines, "City")
    if city:
        city = re.sub(r"\s*[A-Z]\d[A-Z]\s?\d[A-Z]\d\s*$", "", city).strip()

    data = {
        "mls_number": _find(lines, "MLS #"),
        "status": _find(lines, "Status"),
        "address": _find(lines, "Address"),
        "city": city,
        "district": _find(lines, "District"),
        "sub_district": _find(lines, "Sub District"),
        "postal_code": postal.group(0) if postal else None,

        "list_price": _money(list_raw),
        "list_price_raw": list_raw,
        "sold_price": _money(sold_raw),
        "sold_price_raw": sold_raw,
        "is_sold": bool((_find(lines, "Status") or "").strip().upper().startswith("SOLD")
                        or _money(sold_raw)),

        "property_type": _find(lines, "Type"),
        "sub_type": _find(lines, "SubType"),
        "style": _find(lines, "STYLE"),

        "beds_above_grade": beds[0] if len(beds) >= 1 else None,
        "beds_below_grade": beds[1] if len(beds) >= 2 else None,
        "beds_total": beds[2] if len(beds) >= 3 else (beds[0] if beds else None),
        "baths_full": baths[0] if len(baths) >= 1 else None,
        "baths_half": baths[1] if len(baths) >= 2 else None,
        "baths_total": baths[2] if len(baths) >= 3 else None,

        "sqft": _range(_find(lines, "SqFt")),
        "age": _range(_find(lines, "Age (Building)")),
        "lot_size": _find(lines, "Lot Size"),
        "acreage": _find(lines, "Acreage"),

        "garage": _find(lines, "GARAGE TYPE/SIZE"),
        "driveway_size": _find(lines, "DRIVEWAY SIZE"),
        "driveway_details": _find(lines, "DRIVEWAY DETAILS"),

        # middle-column features: bound at x=410 so they don't grab the
        # right-column feature text that wraps onto the same visual line.
        "basement": _find(lines, "BASEMENT 1", max_x=410),
        "basement_finish": _find(lines, "BASEMENT FINISH", max_x=410),
        "foundation": _find(lines, "FOUNDATION", max_x=410),

        "heating_type": _find(lines, "HEATING TYPE"),
        "heating_source": _find(lines, "HEATING SOURCE"),
        "central_air": "central air" in full_text.lower(),

        "exterior_finish": _find(lines, "EXTERIOR FINISH", max_x=410),
        "water": _find(lines, "WATER/WELL", max_x=410),
        "sewer": _find(lines, "SEWER/SEPTIC", max_x=410),
        "services": _find(lines, "SERVICES AVAILABLE", max_x=410),
        "features_interior": _find(lines, "FEATURES INTERIOR"),
        "features_exterior": _find(lines, "FEATURES EXTERIOR"),

        "waterfront": _find(lines, "Waterfront"),
        "annual_taxes": _money(_find(lines, "Annual Taxes $")),
        "tax_year": _find(lines, "Tax Year"),
        "assessment": _money(_find(lines, "Assessment $")),

        "list_date": _find(lines, "List Date"),
        "closing_date": _find(lines, "Closing Date"),
        "firm_date": _find(lines, "Firm Date"),

        "rooms": _rooms(lines),
    }
    return data


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if not target:
        print("usage: python parser.py <path-to-mls.pdf>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(parse_pdf(target), indent=2, ensure_ascii=False))
