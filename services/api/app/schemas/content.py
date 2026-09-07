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


class FooterLink(BaseModel):
    slug: str
    title: str
