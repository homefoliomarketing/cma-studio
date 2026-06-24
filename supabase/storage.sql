-- Storage: 'media' bucket for MLS photos / page renders.
-- PUBLIC bucket (documented fallback): the report print path needs stable,
-- synchronous image URLs (getPublicUrl) - signed URLs fight window.print().
-- Paths embed the user's uid + a random cmaId, so URLs are unguessable.
-- Writes are still locked to each user's own folder by the media_own policy.
insert into storage.buckets (id, name, public)
values ('media','media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "media_own" on storage.objects;
create policy "media_own" on storage.objects for all to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
