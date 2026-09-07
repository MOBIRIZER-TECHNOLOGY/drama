import httpx

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str, secret: str, remote_ip: str | None = None) -> bool:
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(VERIFY_URL, data=data)
        return bool(r.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False
