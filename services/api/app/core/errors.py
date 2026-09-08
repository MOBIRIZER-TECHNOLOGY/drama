from fastapi import HTTPException, status


class AppError(HTTPException):
    code: str = "app_error"

    def __init__(self, detail: str, status_code: int = status.HTTP_400_BAD_REQUEST, code: str | None = None):
        super().__init__(status_code=status_code, detail={"code": code or self.code, "message": detail})


class NotFound(AppError):
    code = "not_found"

    def __init__(self, what: str = "Resource"):
        super().__init__(f"{what} not found", status.HTTP_404_NOT_FOUND)


class Unauthorized(AppError):
    code = "unauthorized"

    def __init__(self, detail: str = "Authentication required", code: str | None = None):
        # A caller-supplied code lets the console tell "your session was revoked" and "we need your
        # authenticator code" apart from "your password is wrong", which are three different screens.
        super().__init__(detail, status.HTTP_401_UNAUTHORIZED, code=code)


class Forbidden(AppError):
    code = "forbidden"

    def __init__(self, detail: str = "Not allowed"):
        super().__init__(detail, status.HTTP_403_FORBIDDEN)


class Conflict(AppError):
    code = "conflict"

    def __init__(self, detail: str, code: str = "conflict"):
        super().__init__(detail, status.HTTP_409_CONFLICT, code)


class AgeGateRequired(AppError):
    """Adult-rated content before the viewer has confirmed their age. Always 403, from play and from unlock."""

    code = "age_gate_required"

    def __init__(self, detail: str = "Confirm your age to watch this"):
        super().__init__(detail, status.HTTP_403_FORBIDDEN)


class InsufficientCoins(AppError):
    code = "insufficient_coins"

    def __init__(self, needed: int, balance: int):
        super().__init__(f"Need {needed} coins, balance is {balance}", status.HTTP_402_PAYMENT_REQUIRED)
