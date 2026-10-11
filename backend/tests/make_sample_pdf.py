"""Generate a realistic networking PDF for manual and automated verification.

The document deliberately includes the noise patterns reported in the bug:
a running page header, instructions, existing practice questions and an answer
key, mixed in with real teaching content.

Usage:  .\\venv\\Scripts\\python.exe tests\\make_sample_pdf.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import fitz  # noqa: E402

PAGES: list[str] = [
    """
Computer Networking Fundamentals

Page 1 of 3

Chapter 4: Network Layers

The OSI model is a seven layer reference model used to describe network communication.
The physical layer transmits raw bits across a physical medium such as copper or fibre.
The data link layer provides node to node data transfer and error detection.
The network layer routes packets between different networks using logical addresses.
The transport layer provides end to end communication and flow control.
The session layer manages dialogues between applications on different hosts.
The presentation layer translates data between application formats and character encoding.
The application layer provides network services directly to user facing applications.

Instructions: Answer the following questions based on the passage above.

Question 1: Which OSI layer routes packets between networks?
a) The transport layer
b) The network layer
c) The data link layer

Q2. What is the function of the physical layer?
2. Name the seven layers of the OSI model.

Answers: 1-b 2-seven layers
Ans: 1-b

Page 2 of 3
""",
    """
Internet Protocol Suite

The transmission control protocol provides reliable ordered delivery of data.
The user datagram protocol provides connectionless delivery without delivery guarantees.
The internet protocol addresses every host with a hierarchical logical address.
A subnet mask divides an IP address into network and host portions.
A default gateway forwards traffic destined for other networks.
The domain name system translates human readable names into IP addresses.
A subnet is a segmented portion of a network defined by the subnet mask.
Network address translation maps private internal addresses to public addresses.
The address resolution protocol maps IP addresses to physical MAC addresses.

Practice Questions

Read the passage and choose the correct answer for each item.

Which protocol guarantees ordered delivery of data?
Which protocol maps IP addresses to MAC addresses?

Key: TCP, ARP

Page 3 of 3
""",
]


def build(path: Path) -> Path:
    document = fitz.open()

    for body in PAGES:
        page = document.new_page()
        lines = [line for line in body.strip().splitlines()]
        # Preserve blank lines so line-oriented extraction still works.
        page.insert_textbox(fitz.Rect(50, 50, 560, 790), "\n".join(lines), fontsize=9.5, fontname="helv")

    document.save(path)
    document.close()
    return path


if __name__ == "__main__":
    target = BACKEND_DIR.parent / "test.pdf"
    print(f"Wrote {build(target)}")