import pytest

from app.core.errors import AppError
from app.services.html import sanitize_body_html, validate_embed_html


def test_sanitize_strips_scripts_and_keeps_structure():
    out = sanitize_body_html('<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:evil()">l</a></p>')
    assert "<script" not in out and "onclick" not in out and "javascript:" not in out
    assert out.startswith("<p>Hi ")


def test_embed_allowlist():
    ok = validate_embed_html('<iframe width="560" src="https://www.youtube.com/embed/abc"></iframe>')
    assert ok.startswith('<iframe src="https://www.youtube.com/embed/abc"') and "sandbox=" in ok
    assert validate_embed_html("  ") is None
    with pytest.raises(AppError):
        validate_embed_html('<iframe src="https://evil.example/x"></iframe>')
    with pytest.raises(AppError):
        validate_embed_html('<div><iframe src="https://www.youtube.com/embed/abc"></iframe></div>')
    with pytest.raises(AppError):
        validate_embed_html('<iframe src="http://www.youtube.com/embed/abc"></iframe>')
