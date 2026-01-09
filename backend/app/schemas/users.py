from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UserCreateRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=220)


class UserUpdateRequest(UserCreateRequest):
    pass


class UserOut(BaseModel):
    user_id: str
    display_name: str
    email: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None
