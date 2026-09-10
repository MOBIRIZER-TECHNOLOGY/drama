"""Free-text search input, made safe for LIKE.

`%` and `_` are wildcards inside a LIKE pattern. Interpolating a search box straight into `%{q}%` therefore let
a query of `%` match every row and `_` match any single character, which is a way to turn a bounded search into
a full scan on demand. The characters are escaped here and every `ilike` that takes user text passes the same
escape character, so the database reads them literally.
"""

LIKE_ESCAPE = "\\"


def like_pattern(q: str) -> str:
    """`%escaped%` for a contains-search; use with `.ilike(pattern, escape=LIKE_ESCAPE)`."""
    escaped = (
        q.strip().replace(LIKE_ESCAPE, LIKE_ESCAPE * 2).replace("%", f"{LIKE_ESCAPE}%").replace("_", f"{LIKE_ESCAPE}_")
    )
    return f"%{escaped}%"
