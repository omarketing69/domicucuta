-- Create order_status_history table to audit every order status transition
create table if not exists public.order_status_history (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  from_status  text not null,
  to_status    text not null,
  changed_at   timestamptz not null default now(),
  note         text
);

-- Index for fast per-order history lookup
create index if not exists order_status_history_order_id_idx
  on public.order_status_history (order_id, changed_at desc);

-- RLS: match orders table policy — only the owning business can read/write
alter table public.order_status_history enable row level security;

-- Business owners read history for orders belonging to their business
create policy "business owners can read order history"
  on public.order_status_history for select
  using (
    exists (
      select 1 from public.orders o
      join public.businesses b on b.id = o.business_id
      where o.id = order_status_history.order_id
        and b.owner_id = auth.uid()
    )
  );

-- Business owners insert history for their own orders
create policy "business owners can insert order history"
  on public.order_status_history for insert
  with check (
    exists (
      select 1 from public.orders o
      join public.businesses b on b.id = o.business_id
      where o.id = order_status_history.order_id
        and b.owner_id = auth.uid()
    )
  );
