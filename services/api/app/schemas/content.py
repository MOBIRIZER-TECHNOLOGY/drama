from datetime import datetime

from pydantic import BaseModel


class LanguageOut(BaseModel):
    code: str
    name: str
    native_name: str | None
    rtl: bool


class TranslationsOut(BaseModel):
    lang: str
    messages: dict[str, str]


class CmsPageOut(BaseModel):
    slug: str
    title: str
    body_html: str
    lang: str
    # Terms and privacy pages are read to find out what changed and when; a policy with no date is one a
    # reader cannot tell from a stale copy.
    updated_at: datetime | None = None


class FooterLink(BaseModel):
    slug: str
    title: str
