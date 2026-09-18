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
BLOCK_SCALAR_RE = re.compile(
    r"^([|>])(?:(?:[+-]([1-9])?)|(?:([1-9])[+-]?))?(?:[ \t]+#.*|[ \t]*)$"
)


def _block_indent_indicator(match):
    value = match.group(2) or match.group(3)
    return int(value) if value is not None else None


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


def _split_flow_items(value):
    """Split one flow collection without losing nested collections or quotes."""
    closing = "]" if value.startswith("[") else "}"
    stack = [closing]
    quote = None
    escaped = False
    items = []
    item_start = 1
    index = 1
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
            if not stack:
                if value[index + 1 :].strip():
                    raise FrontmatterError("Unexpected content after flow collection")
                final_item = value[item_start:index].strip()
                if final_item:
                    items.append(final_item)
                elif item_start != 1 and not items:
                    raise FrontmatterError("Empty flow collection entry")
                return items
        elif char == "," and len(stack) == 1:
            item = value[item_start:index].strip()
            if not item:
                raise FrontmatterError("Empty flow collection entry")
            items.append(item)
            item_start = index + 1
        index += 1

    if quote is not None or escaped:
        raise FrontmatterError("Unterminated quoted scalar in flow collection")
    raise FrontmatterError(f"Unterminated flow collection, expected '{stack[-1]}'")


def _split_flow_mapping_entry(value, required=False):
    """Find a flow-mapping colon without mistaking nested values or URLs for it."""
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
        elif char == ":" and not stack and (
            required
            or index + 1 == len(value)
            or value[index + 1].isspace()
            or value.lstrip().startswith(('"', "'"))
        ):
            return value[:index], value[index + 1 :]
        index += 1
    if quote is not None or escaped:
        raise FrontmatterError("Unterminated quoted scalar")
    if stack:
        raise FrontmatterError(f"Unterminated flow collection, expected '{stack[-1]}'")
    return None


def _validate_flow_mapping_entry(value, required):
    mapping_entry = _split_flow_mapping_entry(value, required)
    if mapping_entry is None:
        if required:
            raise FrontmatterError("Flow mapping entry is missing ':'")
        _parse_scalar(value)
        return

    raw_key, raw_value = mapping_entry
    if not raw_key.strip():
        raise FrontmatterError("Flow mapping entry is missing a key")
    key = _parse_scalar(raw_key.strip())
    if not isinstance(key, (str, int, float, bool)):
        raise FrontmatterError("Invalid flow mapping key")
    _parse_scalar(raw_value.strip())


def _parse_flow_collection(value):
    items = _split_flow_items(value)
    is_mapping = value.startswith("{")
    for item in items:
        _validate_flow_mapping_entry(item, required=is_mapping)
    return {} if is_mapping else []


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
        inner = value[1:-1]
        index = 0
        while index < len(inner):
            if inner[index] != "'":
                index += 1
                continue
            if index + 1 >= len(inner) or inner[index + 1] != "'":
                raise FrontmatterError(
                    "Single quotes inside a single-quoted scalar must be doubled"
                )
            index += 2
        return inner.replace("''", "'")

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


def _block_value(lines, start, style, indent_indicator=None):
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
            if indent_indicator is not None and indent < indent_indicator:
                raise FrontmatterError(
                    f"Block scalar content must be indented at least {indent_indicator} spaces"
                )
            minimum_indent = indent if minimum_indent is None else min(minimum_indent, indent)
        captured.append(line)
        cursor += 1
    indent = indent_indicator if indent_indicator is not None else minimum_indent or 0
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


def _split_mapping_entry(value):
    """Find a block-mapping colon without mistaking quotes/flows/URLs for it."""
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
        elif char == ":" and not stack and (
            index + 1 == len(value) or value[index + 1].isspace()
        ):
            return value[:index], value[index + 1 :]
        index += 1
    if quote is not None or escaped:
        raise FrontmatterError("Unterminated quoted scalar")
    if stack:
        raise FrontmatterError(f"Unterminated flow collection, expected '{stack[-1]}'")
    return None


def _validate_nested_entry(text, line_number):
    sequence_entry = text == "-" or text.startswith("- ") or text.startswith("-\t")
    sequence_content_indent = (
        1 + len(text[1:]) - len(text[1:].lstrip()) if sequence_entry else 0
    )
    value = text[sequence_content_indent:] if sequence_entry else text
    if not value or value.startswith("#"):
        return True, False, "sequence" if sequence_entry else "scalar"

    mapping_entry = _split_mapping_entry(value)
    if mapping_entry is not None:
        raw_key, raw_value = mapping_entry
        if not raw_key.strip():
            raise FrontmatterError(f"Missing mapping key on line {line_number}")
        key = _parse_scalar(raw_key.strip())
        if not isinstance(key, (str, int, float, bool)):
            raise FrontmatterError(f"Invalid mapping key on line {line_number}")
        scalar_value = raw_value.lstrip()
        if not scalar_value or scalar_value.startswith("#"):
            return True, False, "sequence" if sequence_entry else "mapping"
        block_match = BLOCK_SCALAR_RE.match(scalar_value)
        if block_match:
            return (
                True,
                sequence_content_indent + (_block_indent_indicator(block_match) or 1),
                "sequence" if sequence_entry else "mapping",
            )
        _parse_scalar(scalar_value)
        # A sequence item may start a mapping whose sibling keys are indented
        # beneath the dash even when this first key already has a value.
        return sequence_entry, False, "sequence" if sequence_entry else "mapping"

    block_match = BLOCK_SCALAR_RE.match(value)
    if block_match:
        return (
            True,
            sequence_content_indent + (_block_indent_indicator(block_match) or 1),
            "sequence" if sequence_entry else "scalar",
        )
    _parse_scalar(value)
    return False, False, "sequence" if sequence_entry else "scalar"


def _parse_nested_block(lines, start):
    """Validate an indented YAML subset and retain only its collection type.

    The bundled tools inspect only top-level fields, but nested metadata still
    has to be structurally valid. This walks every nested entry, validates its
    scalar/flow syntax, and enforces indentation transitions without adding a
    third-party YAML dependency.
    """
    cursor = start
    indent_levels = []
    previous_allows_child = True
    block_scalar_parent_indent = None
    block_scalar_required_indent = None
    collection = None

    while cursor < len(lines):
        line = lines[cursor]
        if not line.strip():
            cursor += 1
            continue
        if line.startswith("\t"):
            raise FrontmatterError(f"Nested values must use space indentation on line {cursor + 1}")
        indent = len(line) - len(line.lstrip(" "))
        stripped = line[indent:]
        if indent == 0:
            break
        if stripped.startswith("#"):
            cursor += 1
            continue

        if block_scalar_parent_indent is not None:
            if indent >= block_scalar_required_indent:
                cursor += 1
                continue
            if indent > block_scalar_parent_indent:
                raise FrontmatterError(
                    f"Block scalar content is under-indented on line {cursor + 1}"
                )
            block_scalar_parent_indent = None
            block_scalar_required_indent = None

        if not indent_levels:
            indent_levels.append([indent, None])
            collection = [] if stripped == "-" or stripped.startswith(("- ", "-\t")) else {}
        elif indent > indent_levels[-1][0]:
            if not previous_allows_child:
                raise FrontmatterError(f"Unexpected indentation on line {cursor + 1}")
            indent_levels.append([indent, None])
        elif indent < indent_levels[-1][0]:
            while indent_levels and indent < indent_levels[-1][0]:
                indent_levels.pop()
            if not indent_levels or indent != indent_levels[-1][0]:
                raise FrontmatterError(f"Inconsistent indentation on line {cursor + 1}")

        previous_allows_child, block_indent, entry_kind = _validate_nested_entry(
            stripped,
            cursor + 1,
        )
        if indent_levels[-1][1] is None:
            indent_levels[-1][1] = entry_kind
        elif indent_levels[-1][1] != entry_kind:
            raise FrontmatterError(f"Mixed collection types on line {cursor + 1}")
        if block_indent is not False:
            block_scalar_parent_indent = indent
            block_scalar_required_indent = indent + block_indent
        cursor += 1

    return collection, cursor


def parse_frontmatter(frontmatter_text):
    """Parse top-level Skill fields without requiring PyYAML.

    Nested values are validated and retained as opaque collections because the
    bundled tools only inspect top-level key names plus scalar name/description.
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
            value, index = _block_value(
                lines,
                index + 1,
                block_match.group(1),
                _block_indent_indicator(block_match),
            )
            result[key] = value
            continue

        if not raw_value.strip() or raw_value.lstrip().startswith("#"):
            value, index = _parse_nested_block(lines, index + 1)
            result[key] = value
            continue

        result[key] = _parse_scalar(raw_value)
        index += 1
    return result
