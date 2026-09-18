"""Frontmatter parsing backed by the vendored PyYAML runtime."""

import re
import sys
from pathlib import Path


VENDOR_ROOT = Path(__file__).resolve().parent / "_vendor"
sys.path.insert(0, str(VENDOR_ROOT))

import yaml  # noqa: E402
from yaml.nodes import MappingNode, ScalarNode, SequenceNode  # noqa: E402


class FrontmatterError(ValueError):
    pass


FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)",
    re.DOTALL,
)


def split_frontmatter(content):
    match = FRONTMATTER_RE.match(content)
    if not match:
        raise FrontmatterError("Invalid frontmatter format")
    return match.group(1), match.end()


def _reject_duplicate_mapping_keys(node, visited=None):
    """Match js-yaml's default duplicate-key rejection before construction."""
    if visited is None:
        visited = set()
    identity = id(node)
    if identity in visited:
        return
    visited.add(identity)

    if isinstance(node, MappingNode):
        keys = set()
        for key_node, value_node in node.value:
            if isinstance(key_node, ScalarNode):
                key = (key_node.tag, key_node.value)
                if key in keys:
                    raise FrontmatterError(
                        f"Duplicate mapping key '{key_node.value}' on line {key_node.start_mark.line + 1}"
                    )
                keys.add(key)
            _reject_duplicate_mapping_keys(key_node, visited)
            _reject_duplicate_mapping_keys(value_node, visited)
    elif isinstance(node, SequenceNode):
        for value_node in node.value:
            _reject_duplicate_mapping_keys(value_node, visited)


def parse_frontmatter(frontmatter_text):
    try:
        root = yaml.compose(frontmatter_text, Loader=yaml.SafeLoader)
        if root is not None:
            _reject_duplicate_mapping_keys(root)
        return yaml.safe_load(frontmatter_text)
    except FrontmatterError:
        raise
    except yaml.YAMLError as exc:
        raise FrontmatterError(str(exc)) from exc
