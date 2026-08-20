# DomiCircusPop / MenuApp

A digital menu SaaS platform that lets food businesses create a public menu with a unique link, manage products/categories/orders, and receive orders via WhatsApp.

## Architecture

This is a **pure client-side React + Vite SPA** — there is no custom backend server. All backend logic is handled by:

- **Supabase** (project: `khhxcruhhhzuuykfeivd`) — database (PostgreSQL), authentication, row-level security
- **Supabase Storage** — image/logo uploads (buckets: `images`, `logos`)
- **Supabase Edge Functions** — admin operations requiring service-role access (`create-business-user`, `reassign-business-owner`, `update-client-credentials`)

## Flavors Feature

Flavors (sabores) are stored in the `toppings` table with a `__SABOR__` prefix in the `name` column. Helper functions in `src/lib/flavorUtils.ts` handle prefix logic (`isFlavor`, `isTopping`, `stripFlavorPrefix`, `addFlavorPrefix`). The admin manages flavors via `/admin/flavors` and toppings via `/admin/toppings` — each view filters by prefix. Products can have both toppings and flavors assigned via `product_toppings`. The public menu shows a flavor selection modal when a product has flavors.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6, React Query, React Hook Form + Zod
- **Auth & Database**: Supabase (`@supabase/supabase-js`)
- **Charting**: Recharts
- **UI Extras**: Sonner (toasts), Vaul (drawer), Lucide icons

## Project Structure

```
src/
  App.tsx                  - Root routes (public, admin, superadmin)
  contexts/AuthContext.tsx - Auth state, isAdmin check
  hooks/useBusiness.ts     - Current user's business data
  hooks/useCart.ts         - Shopping cart logic
  integrations/supabase/   - Supabase client + generated types
  pages/
    Login.tsx / Register.tsx / Onboarding.tsx
    Pricing.tsx            - Public pricing page
    PublicMenu.tsx         - Customer-facing menu (route: /b/:slug)
    admin/                 - Business owner dashboard
    superadmin/            - Platform admin panel
  components/ui/           - shadcn/ui components
  lib/whatsapp.ts          - WhatsApp message builder

supabase/
  migrations/              - All DB schema migrations
  functions/               - Edge functions (create-business-user, reassign-business-owner, update-client-credentials)
```

## User Roles

- **admin** (superadmin): Platform owner — can manage all businesses, create/reassign owners, set pricing
- **user**: Business owner — manages their own products, categories, orders, settings

## Key Routes

- `/pricing` — Public landing + pricing
- `/b/:slug` — Public menu for a business
- `/login`, `/register` — Auth
- `/admin/onboarding` — Business setup after register
- `/admin/dashboard` — Business dashboard
- `/superadmin` — Platform admin panel

## Supabase Configuration

Credentials are hardcoded in `vite.config.ts` and injected into the frontend via Vite's `define` block:
- `SUPABASE_URL` = `https://khhxcruhhhzuuykfeivd.supabase.co`
- `SUPABASE_ANON_KEY` = the project's anon JWT (public)
- `SUPABASE_ACCESS_TOKEN` = PAT stored as Replit secret (used for Management API calls)

These are injected as `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` so `src/integrations/supabase/client.ts` can read them.

## Migration Status (March 2026) — COMPLETE

Fully migrated from Lovable-owned Supabase (`wyvimpxwgttscujomkyo`) to user-owned (`khhxcruhhhzuuykfeivd`).
- Schema: 11 tables (businesses, categories, products, toppings, product_toppings, orders, order_items, order_status_history, customers, user_roles, plan_pricing), full RLS, all triggers, all functions
- Storage: `logos` and `images` buckets (public) — all product images on new project storage
- Data: 3 businesses, 14 categories, 38 products, 42 toppings, 3 plan_pricing rows
- Auth users: `o_rivera@hotmail.com` (superadmin/admin), `eduardoosorioovallos@gmail.com` (pizza brisas), `elchapo@gmail.com` (el chapo)
- Business slugs: `pollo-pop`, `pizza-brisas`, `el-chapo`
- Triggers: `trg_auto_register_customer` (orders INSERT), `orders_updated_at`, `businesses_updated_at`, `products_updated_at`
- Functions: `auto_register_customer`, `assign_default_role`, `handle_updated_at`, `has_role`

## Orders Kanban (March 2026)

`src/pages/admin/Orders.tsx` — 4-column Kanban (Entrada/En preparación/En camino/Entregado) with:
- Drag-and-drop via `@dnd-kit/core` (PointerSensor + TouchSensor)
- Optimistic status updates + `order_status_history` logging
- WhatsApp notification banner after each drag with pre-filled message per status
- Metrics bar (new, in prep, in transit, delivered today)
- Urgent badge on orders > 25 min old
- Cancel order + show/hide cancelled list toggle
- Realtime subscription on orders table

## CRM Visual de Clientes (March 2026)

`src/pages/admin/Customers.tsx` — Redesigned CRM with:
- Card grid layout (1/2/3/4 cols responsive) replacing the old table/list view
- Each card shows: initials avatar, name, phone, colored tag chips, order count, last order date, notes preview, active/inactive left-border strip
- Tag system: VIP (violet), Frecuente (blue), Inactivo (gray), Nueva zona (green), Corporativo (orange) — stored as `TEXT[]` in Supabase `customers.tags`
- CustomerDetailSheet (right panel) on card click: stats grid (pedidos/último/gastado), tag toggles, inline notes with auto-save (1.2s debounce), order history from `orders` by `customer_phone`
- DB migration: `supabase/migrations/20260327000001_customers_tags.sql` (adds `tags TEXT[]` column + GIN index)
- All existing features preserved: import CSV/Excel, export, DifusionesDialog, CRUD, pagination, search, tab filters

## Running

```bash
npm run dev   # Development server on port 5000
npm run build # Production build
```
