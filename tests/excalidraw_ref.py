#!/usr/bin/env python3
"""Independent reference for tests/excalidraw.test.mjs (stdlib only, read-only).

  excalidraw_ref.py census <folder>   -> JSON {file name: {element type: count}} (non-deleted)
  excalidraw_ref.py decode <file>     -> the drawing's scene JSON text, UTF-16LE on stdout

lz-string decompressFromBase64 is a straight port of the reference implementation.
"""
import json
import os
import re
import sys

KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
REV = {c: i for i, c in enumerate(KEY)}


def decompress_b64(s):
    if not s:
        return ""
    vals = [REV.get(c, 0) for c in s]
    length = len(vals)
    reset = 32
    dictionary = {0: 0, 1: 1, 2: 2}
    enlarge, dsize, nbits = 4, 4, 3
    result = []
    st = {"val": vals[0], "pos": reset, "idx": 1}

    def bits(n):
        b, p = 0, 1
        for _ in range(n):
            res = st["val"] & st["pos"]
            st["pos"] >>= 1
            if st["pos"] == 0:
                st["pos"] = reset
                st["val"] = vals[st["idx"]] if st["idx"] < length else 0
                st["idx"] += 1
            if res:
                b |= p
            p <<= 1
        return b

    c = bits(2)
    if c == 0:
        c = chr(bits(8))
    elif c == 1:
        c = chr(bits(16))
    else:
        return ""
    dictionary[3] = c
    w = c
    result.append(c)
    while True:
        if st["idx"] > length:
            return ""
        c = bits(nbits)
        if c == 0:
            dictionary[dsize] = chr(bits(8))
            dsize += 1
            c = dsize - 1
            enlarge -= 1
        elif c == 1:
            dictionary[dsize] = chr(bits(16))
            dsize += 1
            c = dsize - 1
            enlarge -= 1
        elif c == 2:
            return "".join(result)
        if enlarge == 0:
            enlarge = 2 ** nbits
            nbits += 1
        if c in dictionary:
            entry = dictionary[c]
        elif c == dsize:
            entry = w + w[0]
        else:
            return None
        result.append(entry)
        dictionary[dsize] = w + entry[0]
        dsize += 1
        enlarge -= 1
        w = entry
        if enlarge == 0:
            enlarge = 2 ** nbits
            nbits += 1


def scene_text(path):
    t = open(path, encoding="utf-8", errors="surrogateescape").read()
    m = re.search(r"```compressed-json\n(.*?)```", t, re.S)
    if m:
        s = decompress_b64(re.sub(r"\s", "", m.group(1)))
        return s[: s.rfind("}") + 1]
    m = re.search(r"```json\n(.*?)```", t, re.S)
    if m:
        return m.group(1)[: m.group(1).rfind("}") + 1]
    if t.lstrip().startswith("{"):
        return t
    return None


def main():
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == "census":
        out = {}
        for name in sorted(os.listdir(arg)):
            if not name.endswith(".md"):
                continue
            s = scene_text(os.path.join(arg, name))
            if s is None:
                out[name] = None
                continue
            counts = {}
            for el in json.loads(s).get("elements", []):
                if el.get("isDeleted"):
                    continue
                counts[el["type"]] = counts.get(el["type"], 0) + 1
            out[name] = counts
        sys.stdout.write(json.dumps(out))
    elif cmd == "decode":
        s = scene_text(arg)
        sys.stdout.buffer.write((s or "").encode("utf-16-le", "surrogatepass"))
    else:
        sys.exit("unknown command")


if __name__ == "__main__":
    main()
