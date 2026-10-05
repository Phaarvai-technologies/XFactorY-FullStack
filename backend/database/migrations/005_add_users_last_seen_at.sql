-- Required by ManufacturerRepository.touch_last_seen().
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;