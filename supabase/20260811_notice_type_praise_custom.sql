-- Add "칭찬합니다" (praise) and "직접 입력" (custom, free-text label) notice types.
-- Run this file ALONE first, then run 20260811_notice_custom_type_label.sql separately --
-- Postgres cannot use a freshly-added enum value in the same transaction that added it, and the
-- next migration's CHECK constraint references 'custom' directly.

alter type public.notice_type add value if not exists 'praise';
alter type public.notice_type add value if not exists 'custom';
