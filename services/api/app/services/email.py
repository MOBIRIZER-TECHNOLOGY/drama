"""Transactional email over SMTP (Mailpit locally). Used for admin password resets; product mail comes later."""

from email.message import EmailMessage

import aiosmtplib
import structlog

from app.core.config import get_settings

log = structlog.get_logger()


async def send(to: str, subject: str, text: str, html: str | None = None) -> bool:
    s = get_settings()
    if not s.smtp_host:
        log.warning("email.skipped_no_smtp", to=to, subject=subject)
        return False
    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        await aiosmtplib.send(
            msg,
            hostname=s.smtp_host,
            port=s.smtp_port,
            username=s.smtp_user or None,
            password=s.smtp_password or None,
            start_tls=s.smtp_starttls,
            timeout=15,
        )
        return True
    except aiosmtplib.SMTPException as exc:
        log.error("email.failed", to=to, error=str(exc))
        return False
