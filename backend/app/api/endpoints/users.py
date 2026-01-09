from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.db.repository import create_user, delete_user, get_user, list_users, update_user
from app.schemas.users import UserCreateRequest, UserOut, UserUpdateRequest


router = APIRouter()


@router.get("", response_model=list[UserOut])
def api_list_users(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[UserOut]:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    rows = list_users(db, limit=limit, offset=offset)
    return [
        UserOut(
            user_id=r.user_id,
            display_name=r.display_name,
            email=r.email,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("", response_model=UserOut)
def api_create_user(req: UserCreateRequest, db: Session = Depends(get_db)) -> UserOut:
    uid = create_user(db, display_name=req.display_name.strip(), email=req.email)
    rec = get_user(db, uid)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load user after write")
    return UserOut(
        user_id=rec.user_id,
        display_name=rec.display_name,
        email=rec.email,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
    )


@router.get("/{user_id}", response_model=UserOut)
def api_get_user(user_id: str, db: Session = Depends(get_db)) -> UserOut:
    rec = get_user(db, user_id)
    if not rec:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        user_id=rec.user_id,
        display_name=rec.display_name,
        email=rec.email,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
    )


@router.put("/{user_id}", response_model=UserOut)
def api_update_user(user_id: str, req: UserUpdateRequest, db: Session = Depends(get_db)) -> UserOut:
    ok = update_user(db, user_id=user_id, display_name=req.display_name.strip(), email=req.email)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    rec = get_user(db, user_id)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load user after write")
    return UserOut(
        user_id=rec.user_id,
        display_name=rec.display_name,
        email=rec.email,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
    )


@router.delete("/{user_id}")
def api_delete_user(user_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    ok = delete_user(db, user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted"}
