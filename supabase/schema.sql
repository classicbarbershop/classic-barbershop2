-- =====================================================================
--  Salon-backend (Supabase / Postgres)
--  Eén database voor meerdere zaken: elke zaak heeft een eigen `site`-code
--  (bv. 'classic'). Alles hieronder is veilig om opnieuw uit te voeren.
--
--  Rollen per gebruiker (tabel staff):
--    admin          → mag de website bewerken (teksten, foto's, prijzen, uren)
--    <vestiging-id> → ziet en beheert alleen de agenda van die vestiging
-- =====================================================================

-- ---------- Medewerkers ----------
create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  site    text not null,
  role    text not null
);
alter table public.staff enable row level security;
drop policy if exists "staff_eigen_rij" on public.staff;
create policy "staff_eigen_rij" on public.staff
  for select to authenticated using (user_id = auth.uid());

create or replace function public.my_site() returns text
  language sql stable security definer set search_path = public
as $$ select site from public.staff where user_id = auth.uid() $$;

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public
as $$ select role from public.staff where user_id = auth.uid() $$;

-- ---------- Website-inhoud ----------
create table if not exists public.site_content (
  site       text not null,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (site, key)
);
alter table public.site_content enable row level security;
drop policy if exists "content_lezen" on public.site_content;
drop policy if exists "content_toevoegen" on public.site_content;
drop policy if exists "content_wijzigen" on public.site_content;
drop policy if exists "content_verwijderen" on public.site_content;
create policy "content_lezen" on public.site_content
  for select to anon, authenticated using (true);
create policy "content_toevoegen" on public.site_content
  for insert to authenticated with check (site = public.my_site() and public.my_role() = 'admin');
create policy "content_wijzigen" on public.site_content
  for update to authenticated
  using (site = public.my_site() and public.my_role() = 'admin')
  with check (site = public.my_site() and public.my_role() = 'admin');
create policy "content_verwijderen" on public.site_content
  for delete to authenticated using (site = public.my_site() and public.my_role() = 'admin');

-- ---------- Afspraken ----------
create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  site       text not null,
  loc        text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  category   text,
  service    text not null,
  price      numeric(8,2),
  name       text not null,
  phone      text,
  email      text,
  note       text,
  status     text not null default 'bevestigd'
             check (status in ('bevestigd', 'voltooid', 'niet_gekomen', 'geannuleerd', 'geblokkeerd')),
  source     text not null default 'website' check (source in ('website', 'zaak')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists bookings_agenda on public.bookings (site, loc, starts_at);
alter table public.bookings enable row level security;

-- Klanten (anon) kunnen NIETS lezen of schrijven in deze tabel: boeken gaat via create_booking().
-- Een vestiging ziet alleen haar eigen afspraken.
drop policy if exists "bookings_lezen" on public.bookings;
drop policy if exists "bookings_status" on public.bookings;
create policy "bookings_lezen" on public.bookings
  for select to authenticated using (site = public.my_site() and loc = public.my_role());
create policy "bookings_status" on public.bookings
  for update to authenticated
  using (site = public.my_site() and loc = public.my_role())
  with check (site = public.my_site() and loc = public.my_role());

-- ---------- Instellingen lezen (met standaardwaarden) ----------
create or replace function public._setting(p_site text, p_key text) returns jsonb
  language sql stable security definer set search_path = public
as $$ select value from public.site_content where site = p_site and key = p_key $$;

-- Hoeveel klanten tegelijk per vestiging (aantal stoelen). Standaard 1.
create or replace function public._capacity(p_site text, p_loc text) returns int
  language sql stable security definer set search_path = public
as $$
  select greatest(1, coalesce((
    select (l ->> 'chairs')::int
    from jsonb_array_elements(coalesce(public._setting(p_site, 'locations'), '[]'::jsonb)) l
    where l ->> 'id' = p_loc), 1))
$$;

-- Is de tijd [p_start, p_end) nog vrij? (geblokkeerde tijd telt altijd als vol)
create or replace function public._is_free(p_site text, p_loc text, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
  returns boolean language sql stable security definer set search_path = public
as $$
  select not exists (
           select 1 from public.bookings
           where site = p_site and loc = p_loc and status = 'geblokkeerd'
             and starts_at < p_end and ends_at > p_start
             and id is distinct from p_skip)
     and (select count(*) from public.bookings
          where site = p_site and loc = p_loc and status in ('bevestigd', 'voltooid', 'niet_gekomen')
            and starts_at < p_end and ends_at > p_start
            and id is distinct from p_skip) < public._capacity(p_site, p_loc)
$$;

-- ---------- Openbaar: bezette tijden (zonder klantgegevens) ----------
create or replace function public.get_busy(p_site text, p_loc text, p_from timestamptz, p_to timestamptz)
  returns table (starts_at timestamptz, ends_at timestamptz, blocked boolean)
  language sql stable security definer set search_path = public
as $$
  select b.starts_at, b.ends_at, b.status = 'geblokkeerd'
  from public.bookings b
  where b.site = p_site and b.loc = p_loc
    and b.status in ('bevestigd', 'voltooid', 'niet_gekomen', 'geblokkeerd')
    and b.starts_at < least(p_to, p_from + interval '62 days') and b.ends_at > p_from
  order by b.starts_at
$$;

-- ---------- Openbaar: afspraak maken via de website ----------
-- Prijs en duur komen uit de database (niet van de bezoeker), uren en vrije plaats
-- worden hier gecontroleerd, met een slot zodat twee gelijktijdige boekingen
-- nooit dezelfde tijd kunnen pakken.
create or replace function public.create_booking(
  p_site text, p_loc text, p_service_id text, p_start timestamptz,
  p_name text, p_phone text, p_email text, p_note text default null)
  returns json language plpgsql security definer set search_path = public
as $$
declare
  v_cat      jsonb;
  v_item     jsonb;
  v_settings jsonb := coalesce(public._setting(p_site, 'settings'), '{}'::jsonb);
  v_day      jsonb;
  v_local    timestamp := p_start at time zone 'Europe/Brussels';
  v_today    date := (now() at time zone 'Europe/Brussels')::date;
  v_slot     int := coalesce((v_settings ->> 'slot_min')::int, 30);
  v_fee      numeric := coalesce((v_settings ->> 'online_fee')::numeric, 0);
  v_maxdays  int := coalesce((v_settings ->> 'max_days')::int, 14);
  v_min      int;
  v_dur      int;
  v_end      timestamptz;
  v_digits   text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_id       uuid;
begin
  -- vestiging
  if not exists (select 1 from jsonb_array_elements(coalesce(public._setting(p_site, 'locations'), '[]'::jsonb)) l
                 where l ->> 'id' = p_loc) then
    raise exception 'ongeldige_vestiging';
  end if;

  -- gegevens
  p_name := btrim(coalesce(p_name, ''));
  p_email := lower(btrim(coalesce(p_email, '')));
  if length(p_name) < 2 or length(p_name) > 80 then raise exception 'ongeldige_naam'; end if;
  if length(v_digits) < 9 or length(v_digits) > 15 then raise exception 'ongeldig_telefoonnummer'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_email) > 120 then raise exception 'ongeldig_email'; end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'notitie_te_lang'; end if;

  -- dienst (duur en prijs uit de database)
  select c, i into v_cat, v_item
  from jsonb_array_elements(coalesce(public._setting(p_site, 'services'), '[]'::jsonb)) c,
       jsonb_array_elements(c -> 'items') i
  where i ->> 'id' = p_service_id
  limit 1;
  if v_item is null then raise exception 'onbekende_dienst'; end if;
  v_dur := (v_item ->> 'min')::int;
  if v_dur is null or v_dur < 5 then raise exception 'onbekende_dienst'; end if;
  v_end := p_start + make_interval(mins => v_dur);

  -- tijd
  if p_start < now() + interval '10 minutes' then raise exception 'tijd_voorbij'; end if;
  if v_local::date > v_today + v_maxdays then raise exception 'te_ver_vooruit'; end if;
  v_day := public._setting(p_site, 'hours') -> p_loc -> extract(dow from v_local)::int::text;
  if v_day is null or jsonb_typeof(v_day) <> 'array' then raise exception 'gesloten'; end if;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  if extract(second from v_local) <> 0
     or v_min < (v_day ->> 0)::int
     or v_min + v_dur > (v_day ->> 1)::int
     or (v_min - (v_day ->> 0)::int) % v_slot <> 0 then
    raise exception 'ongeldig_tijdslot';
  end if;

  -- één boeking tegelijk per vestiging verwerken → geen dubbele boekingen
  perform pg_advisory_xact_lock(hashtext('booking:' || p_site || ':' || p_loc));

  if not public._is_free(p_site, p_loc, p_start, v_end) then raise exception 'bezet'; end if;

  -- tegen misbruik: max. 3 openstaande afspraken per telefoonnummer
  if (select count(*) from public.bookings
      where site = p_site and status = 'bevestigd' and starts_at > now()
        and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9)) >= 3 then
    raise exception 'te_veel_afspraken';
  end if;

  insert into public.bookings (site, loc, starts_at, ends_at, category, service, price, name, phone, email, note, source)
  values (p_site, p_loc, p_start, v_end, v_cat ->> 'label', v_item ->> 'name',
          (v_item ->> 'price')::numeric + v_fee, p_name, btrim(p_phone), p_email, nullif(btrim(coalesce(p_note, '')), ''), 'website')
  returning id into v_id;

  return json_build_object('id', v_id, 'starts_at', p_start, 'ends_at', v_end,
                           'service', v_item ->> 'name', 'price', (v_item ->> 'price')::numeric + v_fee);
end;
$$;

-- ---------- Vestiging: afspraak toevoegen / verplaatsen / tijd blokkeren ----------
create or replace function public.staff_save_booking(
  p_id uuid, p_start timestamptz, p_end timestamptz,
  p_category text, p_service text, p_price numeric,
  p_name text, p_phone text, p_email text, p_note text,
  p_status text, p_force boolean default false)
  returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_site text := public.my_site();
  v_loc  text := public.my_role();
  v_id   uuid := p_id;
begin
  if v_site is null or v_loc is null or v_loc = 'admin' then raise exception 'geen_toegang'; end if;
  if p_end <= p_start then raise exception 'ongeldige_tijd'; end if;
  if p_status not in ('bevestigd', 'voltooid', 'niet_gekomen', 'geannuleerd', 'geblokkeerd') then raise exception 'ongeldige_status'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'ongeldige_naam'; end if;
  if p_id is not null and not exists (select 1 from public.bookings where id = p_id and site = v_site and loc = v_loc) then
    raise exception 'geen_toegang';
  end if;

  perform pg_advisory_xact_lock(hashtext('booking:' || v_site || ':' || v_loc));

  if not p_force and p_status <> 'geannuleerd' then
    if p_status = 'geblokkeerd' then
      if exists (select 1 from public.bookings
                 where site = v_site and loc = v_loc and status <> 'geannuleerd'
                   and starts_at < p_end and ends_at > p_start and id is distinct from p_id) then
        raise exception 'overlap';
      end if;
    elsif not public._is_free(v_site, v_loc, p_start, p_end, p_id) then
      raise exception 'overlap';
    end if;
  end if;

  if p_id is null then
    insert into public.bookings (site, loc, starts_at, ends_at, category, service, price, name, phone, email, note, status, source)
    values (v_site, v_loc, p_start, p_end, p_category, coalesce(nullif(btrim(p_service), ''), 'Afspraak'), p_price,
            btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(lower(btrim(coalesce(p_email, ''))), ''),
            nullif(btrim(coalesce(p_note, '')), ''), p_status, 'zaak')
    returning id into v_id;
  else
    update public.bookings set
      starts_at = p_start, ends_at = p_end, category = p_category,
      service = coalesce(nullif(btrim(p_service), ''), service), price = p_price,
      name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), ''),
      email = nullif(lower(btrim(coalesce(p_email, ''))), ''), note = nullif(btrim(coalesce(p_note, '')), ''),
      status = p_status
    where id = p_id;
  end if;
  return v_id;
end;
$$;

-- Tabelrechten expliciet (RLS hierboven bepaalt welke rijen)
revoke all on public.staff, public.site_content, public.bookings from anon, authenticated;
grant select on public.staff to authenticated;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
grant select, update on public.bookings to authenticated;

-- Wie mag wat uitvoeren
revoke all on function public._setting(text, text) from public, anon, authenticated;
revoke all on function public._capacity(text, text) from public, anon, authenticated;
revoke all on function public._is_free(text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.staff_save_booking(uuid, timestamptz, timestamptz, text, text, numeric, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.get_busy(text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_booking(text, text, text, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.staff_save_booking(uuid, timestamptz, timestamptz, text, text, numeric, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.my_site() to authenticated;
grant execute on function public.my_role() to authenticated;

-- ---------- Live-updates voor de agenda ----------
do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ---------- Foto's (opslag) ----------
-- Publieke map 'site'; elke zaak schrijft alleen in haar eigen submap: <site>/...
insert into storage.buckets (id, name, public) values ('site', 'site', true)
  on conflict (id) do update set public = true;
drop policy if exists "fotos_uploaden" on storage.objects;
drop policy if exists "fotos_wijzigen" on storage.objects;
drop policy if exists "fotos_verwijderen" on storage.objects;
create policy "fotos_uploaden" on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and (storage.foldername(name))[1] = public.my_site() and public.my_role() = 'admin');
create policy "fotos_wijzigen" on storage.objects for update to authenticated
  using (bucket_id = 'site' and (storage.foldername(name))[1] = public.my_site() and public.my_role() = 'admin');
create policy "fotos_verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'site' and (storage.foldername(name))[1] = public.my_site() and public.my_role() = 'admin');
