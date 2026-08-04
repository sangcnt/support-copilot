def build_text_pdf(
    lines: list[str] | None = None,
    *,
    title: str = "Support Guide",
) -> bytes:
    text_lines = lines or []
    commands = [b"BT", b"/F1 12 Tf", b"72 720 Td"]

    for index, line in enumerate(text_lines):
        if index > 0:
            commands.append(b"0 -20 Td")

        commands.append(f"({escape_pdf_text(line)}) Tj".encode())

    commands.append(b"ET")
    stream = b"\n".join(commands)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
        f"<< /Title ({escape_pdf_text(title)}) /Author (Sang) >>".encode(),
    ]

    output = b"%PDF-1.4\n"
    offsets = [0]

    for object_number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f"{object_number} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_offset = len(output)
    output += f"xref\n0 {len(objects) + 1}\n".encode()
    output += b"0000000000 65535 f \n"

    for offset in offsets[1:]:
        output += f"{offset:010d} 00000 n \n".encode()

    output += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 6 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF"
    ).encode()

    return output


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
