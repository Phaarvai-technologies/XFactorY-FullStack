import base64
import binascii
import hashlib
from dataclasses import dataclass
from uuid import uuid4

import httpx

from app.core.config import Settings


MAX_BYTES = 10 * 1024 * 1024
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}


@dataclass(frozen=True)
class DecodedImage:
    raw: bytes
    content_type: str
    extension: str
    checksum: str


@dataclass(frozen=True)
class UploadedObject:
    object_key: str
    filename: str
    content_type: str
    size_bytes: int
    checksum: str
    public_url: str


def decode_data_url(data_url: str) -> DecodedImage | None:
    """Decode the `data:image/...;base64,...` strings produced by the frontend FileReader."""
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return None
    try:
        header, encoded = data_url.split(",", 1)
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Image data is not valid base64") from exc
    content_type = header.removeprefix("data:").split(";", 1)[0].lower()
    extension = EXTENSIONS.get(content_type)
    if not extension:
        raise ValueError("Only PNG, JPG and WebP images are supported")
    if len(raw) > MAX_BYTES:
        raise ValueError("Image must be 10 MB or smaller")
    return DecodedImage(raw, "image/jpeg" if extension == "jpg" else content_type, extension,
                        hashlib.sha256(raw).hexdigest())


class SupabaseStorage:
    def __init__(self, settings: Settings):
        self.settings = settings

    def public_base(self) -> str:
        return f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/public/{self.settings.supabase_storage_bucket}"

    def public_url(self, key: str | None) -> str | None:
        return f"{self.public_base()}/{key}" if key else None

    async def upload(self, image: DecodedImage, prefix: str) -> UploadedObject:
        if not self.settings.supabase_url or not self.settings.supabase_service_role_key:
            raise RuntimeError("Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
        key = f"{prefix}/{uuid4()}.{image.extension}"
        url = f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/{self.settings.supabase_storage_bucket}/{key}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "Content-Type": image.content_type,
            "x-upsert": "false",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, content=image.raw)
        if response.status_code >= 400:
            raise RuntimeError(f"Supabase Storage upload failed ({response.status_code}): {response.text[:200]}")
        return UploadedObject(
            object_key=key,
            filename=key.rsplit("/", 1)[-1],
            content_type=image.content_type,
            size_bytes=len(image.raw),
            checksum=image.checksum,
            public_url=self.public_url(key) or "",
        )
