"""HTML that editors store and viewers render: CMS page bodies and legacy iframe embeds.

Editors are trusted staff, not viewers, but an editor account is not an owner account, so stored HTML is
sanitised on write and embeds are restricted to one iframe from an allowlisted player host.
"""

import re
from urllib.parse import urlparse

import nh3

from app.core.errors import AppError

ALLOWED_TAGS = {
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "a",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "blockquote",
    "hr",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
    "div",
    "code",
    "pre",
}
ALLOWED_ATTRS = {
    "a": {"href", "title", "target"},
    "img": {"src", "alt", "width", "height"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    "*": {"class", "dir", "lang"},
}
EMBED_HOSTS = {
    "www.youtube.com",
    "youtube.com",
    "www.youtube-nocookie.com",
    "player.vimeo.com",
    "vimeo.com",
    "www.dailymotion.com",
    "dailymotion.com",
    "geo.dailymotion.com",
}
_IFRAME = re.compile(r"^\s*<iframe\b([^>]*)>\s*(?:</iframe>)?\s*$", re.IGNORECASE | re.DOTALL)
_SRC = re.compile(r"""\bsrc\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


def sanitize_body_html(html: str) -> str:
    return nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
        strip_comments=True,
    )


def validate_embed_html(html: str | None) -> str | None:
    """Accept exactly one <iframe> with an https src on an allowlisted host; return a normalised tag."""
    if html is None or not html.strip():
        return None
    m = _IFRAME.match(html)
    if m is None:
        raise AppError("Embed must be a single <iframe> element", code="bad_embed")
    src = _SRC.search(m.group(1))
    if src is None:
        raise AppError("Embed iframe has no src", code="bad_embed")
    url = urlparse(src.group(1).strip())
    if url.scheme != "https" or url.hostname not in EMBED_HOSTS:
        raise AppError(f"Embed host is not allowed: {url.hostname or 'unknown'}", code="bad_embed")
    return (
        f'<iframe src="{url.geturl()}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen '
        'referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" '
        'frameborder="0"></iframe>'
    )
