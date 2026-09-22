import base64
import hashlib
from dataclasses import dataclass
from uuid import uuid4
import httpx
from app.core.config import Settings


@dataclass(frozen=True)
class UploadedObject:
    object_key: str
    filename: str
    content_type: str
    size_bytes: int
    checksum: str
    public_url: str


class SupabaseStorage:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def upload_data_url(self, data_url: str, prefix: str) -> UploadedObject | None:
        if not data_url.startswith("data:"):
            return None
        header, encoded = data_url.split(",", 1)
        content_type = header.removeprefix("data:").split(";", 1)[0]
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError("Image must be 10 MB or smaller")
        extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(content_type)
        if not extension:
            raise ValueError("Only PNG, JPG and WebP images are supported")
        if not self.settings.supabase_url or not self.settings.supabase_service_role_key:
            raise RuntimeError("Supabase Storage configuration is missing")
        key = f"{prefix}/{uuid4()}.{extension}"
        url = f"{self.settings.supabase_url}/storage/v1/object/{self.settings.supabase_storage_bucket}/{key}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "Content-Type": content_type,
            "x-upsert": "false",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, content=raw)
            response.raise_for_status()
        return UploadedObject(
            object_key=key, filename=key.rsplit("/", 1)[-1], content_type=content_type,
            size_bytes=len(raw), checksum=hashlib.sha256(raw).hexdigest(),
            public_url=f"{self.settings.supabase_url}/storage/v1/object/public/{self.settings.supabase_storage_bucket}/{key}",
        )

