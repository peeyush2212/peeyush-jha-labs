from __future__ import annotations

import json
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle


def build_run_report_pdf(
    *,
    title: str,
    run_meta: dict[str, Any],
    input_payload: dict[str, Any],
    output_payload: dict[str, Any],
    notes: list[str] | None = None,
) -> bytes:
    """Create a compact, interview-friendly PDF report for a saved run.

    This is intentionally simple (no external templates) and focuses on:
    - metadata (run id/type, created time, app version)
    - inputs
    - outputs
    """

    buf = BytesIO()

    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        title=title,
        author=str(run_meta.get("author") or "Peeyush Jha Labs"),
    )

    styles = getSampleStyleSheet()
    story: list[Any] = []

    story.append(Paragraph(title, styles["Title"]))
    story.append(
        Paragraph(
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 10))

    # Meta table
    meta_rows = [[k, str(v)] for k, v in (run_meta or {}).items()]
    if meta_rows:
        t = Table([["Field", "Value"], *meta_rows], colWidths=[120, 410])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b1020")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.whitesmoke),
                ]
            )
        )
        story.append(Paragraph("Run metadata", styles["Heading2"]))
        story.append(t)
        story.append(Spacer(1, 10))

    if notes:
        story.append(Paragraph("Notes", styles["Heading2"]))
        for n in notes:
            story.append(Paragraph(str(n), styles["Normal"]))
        story.append(Spacer(1, 10))

    # Payloads
    story.append(Paragraph("Inputs", styles["Heading2"]))
    story.append(
        Preformatted(json.dumps(input_payload, indent=2, ensure_ascii=False), styles["Code"])
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("Outputs", styles["Heading2"]))
    story.append(
        Preformatted(json.dumps(output_payload, indent=2, ensure_ascii=False), styles["Code"])
    )

    doc.build(story)
    return buf.getvalue()
