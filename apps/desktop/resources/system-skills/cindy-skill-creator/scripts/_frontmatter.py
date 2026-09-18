"""Small, dependency-free reader for the SKILL.md frontmatter fields we inspect."""

import json
import re


class FrontmatterError(ValueError):
    pass


FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)",
    re.DOTALL,
)
TOP_LEVEL_FIELD_RE = re.compile(r"^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$")
BLOCK_SCALAR_RE = re.compile(r"^([|>])(?:[+-])?(?:[1-9])?[ \t]*(?:#.*)?$")


def split_frontmatter(content):
    match = FRONTMATTER_RE.match(content)
    if not match:
        raise FrontmatterError("Invalid frontmatter format")
    return match.group(1), match.end()


def _strip_plain_comment(value):
    quote = None
    escaped = False
    index = 0
    while index < len(value):
        char = value[index]
        if quote == '"':
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quote = None
        elif quote == "'":
            if char == "'" and index + 1 < len(value) and value[index + 1] == "'":
                index += 1
            elif char == "'":
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == "#" and index > 0 and value[index - 1].isspace():
            return value[:index].rstrip()
        index += 1
    return value.strip()


def _parse_flow_collection(value):
    stack = []
    quote = None
    escaped = False
    index = 0
    while index < len(value):
        char = value[index]
        if quote == '"':
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quote = None
        elif quote == "'":
            if char == "'" and index + 1 < len(value) and value[index + 1] == "'":
                index += 1
            elif char == "'":
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char in "[{":
            stack.append("]" if char == "[" else "}")
        elif char in "]}":
            if not stack or stack.pop() != char:
                raise FrontmatterError(f"Mismatched flow delimiter '{char}'")
            if not stack and value[index + 1 :].strip():
                raise FrontmatterError("Unexpected content after flow collection")
        index += 1

    if quote is not None or escaped:
        raise FrontmatterError("Unterminated quoted scalar in flow collection")
    if stack:
        raise FrontmatterError(f"Unterminated flow collection, expected '{stack[-1]}'")
    return [] if value.startswith("[") else {}


def _parse_scalar(raw):
    value = _strip_plain_comment(raw)
    if value.startswith('"'):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError) as exc:
            raise FrontmatterError(f"Invalid double-quoted scalar: {exc}") from exc
        return parsed
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            raise FrontmatterError("Invalid single-quoted scalar")
        return value[1:-1].replace("''", "'")

    lowered = value.lower()
    if lowered in {"null", "~"} or value == "":
        return None
    if lowered in {"true", "false"}:
        return lowered == "true"
    if re.fullmatch(r"[-+]?(?:0|[1-9][0-9]*)", value):
        return int(value)
    if re.fullmatch(r"[-+]?(?:[0-9]+\.[0-9]*|[0-9]*\.[0-9]+)", value):
        return float(value)
    if value.startswith(("[", "{")):
        # The bundled tools only inspect scalar name/description values. Keep
        # flow collection contents opaque while preserving the collection type,
        # so valid YAML bare scalars such as [Read, Grep] and {owner: me} do not
        # require PyYAML or JSON syntax.
        return _parse_flow_collection(value)
    if re.match(r"^(?:[-?:](?:[ \t]|$)|[,\]\}#&*!|>'\"%@`])", value):
        raise FrontmatterError("Invalid leading indicator in plain scalar")
    if re.search(r":[ \t]|:$", value):
        raise FrontmatterError("Plain scalar contains ': ' and must be quoted")
    return value


def _block_value(lines, start, style):
    cursor = start
    captured = []
    minimum_indent = None
    while cursor < len(lines):
        line = lines[cursor]
        if line.strip() and not line[:1].isspace():
            break
        if line.strip():
            indent = len(line) - len(line.lstrip(" "))
            if indent == 0 or line.startswith("\t"):
                raise FrontmatterError("Block scalars must use space indentation")
            minimum_indent = indent if minimum_indent is None else min(minimum_indent, indent)
        captured.append(line)
        cursor += 1
    indent = minimum_indent or 0
    values = [line[indent:] if line.strip() else "" for line in captured]
    if style == "|":
        return "\n".join(values).rstrip("\n"), cursor

    paragraphs = []
    current = []
    for line in values:
        if line:
            current.append(line)
        elif current:
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    return "\n".join(paragraphs), cursor


def parse_frontmatter(frontmatter_text):
    """Parse top-level Skill fields without requiring PyYAML.

    Nested values are retained as opaque dictionaries because the bundled
    validator only needs top-level key names plus scalar name/description.
    """
    lines = frontmatter_text.splitlines()
    result = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        if line[:1].isspace():
            raise FrontmatterError(f"Unexpected indentation on line {index + 1}")
        match = TOP_LEVEL_FIELD_RE.match(line)
        if not match:
            raise FrontmatterError(f"Invalid top-level field on line {index + 1}")
        key, raw_value = match.groups()
        if key in result:
            raise FrontmatterError(f"Duplicate top-level field '{key}'")

        block_match = BLOCK_SCALAR_RE.match(raw_value)
        if block_match:
            value, index = _block_value(lines, index + 1, block_match.group(1))
            result[key] = value
            continue

        if not raw_value.strip() or raw_value.lstrip().startswith("#"):
            cursor = index + 1
            while cursor < len(lines) and (
                not lines[cursor].strip() or lines[cursor][:1].isspace()
            ):
                cursor += 1
            result[key] = {} if cursor > index + 1 else None
            index = cursor
            continue

        result[key] = _parse_scalar(raw_value)
        index += 1
    return result
