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


class FrontmatterLoader(yaml.SafeLoader):
    """SafeLoader with the scalar resolver semantics used by js-yaml 3."""


# gray-matter 4 uses js-yaml 3's DEFAULT_SAFE_SCHEMA. Unlike PyYAML's YAML 1.1
# resolver, it leaves yes/no/on/off as strings, resolves only true/false as
# booleans, and accepts scientific notation without a decimal point.
# Copy the inherited table before editing so other vendored PyYAML consumers
# retain SafeLoader's defaults.
FrontmatterLoader.yaml_implicit_resolvers = {
    first: [
        (tag, resolver)
        for tag, resolver in resolvers
        if tag not in {"tag:yaml.org,2002:bool", "tag:yaml.org,2002:float"}
    ]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
FrontmatterLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)
FrontmatterLoader.add_implicit_resolver(
    "tag:yaml.org,2002:float",
    re.compile(
        r"""^(?:
            [-+]?(?:0|[1-9][0-9_]*)(?:
                \.[0-9_]*(?:[eE][-+]?[0-9]+)?
                |[eE][-+]?[0-9]+
            )
            |\.[0-9_]+(?:[eE][-+]?[0-9]+)?
            |[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*
            |[-+]?\.(?:inf|Inf|INF)
            |\.(?:nan|NaN|NAN)
        )$""",
        re.X,
    ),
    list("-+0123456789."),
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
        root = yaml.compose(frontmatter_text, Loader=FrontmatterLoader)
        if root is not None:
            _reject_duplicate_mapping_keys(root)
        return yaml.load(frontmatter_text, Loader=FrontmatterLoader)
    except FrontmatterError:
        raise
    except yaml.YAMLError as exc:
        raise FrontmatterError(str(exc)) from exc
