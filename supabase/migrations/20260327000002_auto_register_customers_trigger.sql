-- Task #6: Auto-registro de Clientes desde Órdenes
-- Partial unique index + PL/pgSQL trigger function + trigger binding

-- Step 1: Partial unique index on customers(business_id, phone) WHERE phone IS NOT NULL
-- Required by ON CONFLICT clause in Case 1 of the trigger function
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_business_phone
  ON public.customers(business_id, phone)
  WHERE phone IS NOT NULL;

-- Step 2: PL/pgSQL function — auto-register or update customer on every order insert
-- Case 1: phone present → upsert by (business_id, phone), increment counters on conflict
-- Case 2: name only   → find any same-name customer in business; update if found, insert if new
CREATE OR REPLACE FUNCTION public.auto_register_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  -- Case 1: order has a phone number — upsert by (business_id, phone)
  IF NEW.customer_phone IS NOT NULL AND trim(NEW.customer_phone) <> '' THEN
    INSERT INTO public.customers (
      business_id,
      name,
      phone,
      total_orders,
      last_order_at,
      is_active,
      tags
    )
    VALUES (
      NEW.business_id,
      COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Cliente'),
      trim(NEW.customer_phone),
      1,
      NEW.created_at,
      true,
      '{}'
    )
    ON CONFLICT (business_id, phone) WHERE phone IS NOT NULL
    DO UPDATE SET
      total_orders = customers.total_orders + 1,
      last_order_at = GREATEST(customers.last_order_at, NEW.created_at),
      -- Upgrade placeholder name if a real name arrives
      name = CASE
               WHEN customers.name = 'Cliente' AND NULLIF(trim(NEW.customer_name), '') IS NOT NULL
               THEN trim(NEW.customer_name)
               ELSE customers.name
             END;

  -- Case 2: order has a name but no phone
  ELSIF NEW.customer_name IS NOT NULL AND trim(NEW.customer_name) <> '' THEN
    -- Look for any existing customer with same case-insensitive name in this business
    -- (covers customers with or without phone — broader dedup)
    SELECT id INTO v_existing_id
    FROM public.customers
    WHERE business_id = NEW.business_id
      AND lower(trim(name)) = lower(trim(NEW.customer_name))
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Repeat customer — increment counters, never create a duplicate
      UPDATE public.customers
      SET
        total_orders = total_orders + 1,
        last_order_at = NEW.created_at
      WHERE id = v_existing_id;
    ELSE
      -- Truly new name for this business — create the customer record
      INSERT INTO public.customers (
        business_id,
        name,
        phone,
        total_orders,
        last_order_at,
        is_active,
        tags
      )
      VALUES (
        NEW.business_id,
        trim(NEW.customer_name),
        NULL,
        1,
        NEW.created_at,
        true,
        '{}'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Step 3: Attach trigger (drop first to allow idempotent re-runs)
DROP TRIGGER IF EXISTS trg_auto_register_customer ON public.orders;
CREATE TRIGGER trg_auto_register_customer
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_register_customer();
