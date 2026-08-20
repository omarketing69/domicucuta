-- Task #7: Delivery type + address on orders; address on customers

-- Step 1: Add delivery_type and delivery_address to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- Step 2: Add address to customers (last known delivery address)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Step 3: Update auto_register_customer to also save/update address
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
      name = CASE
               WHEN customers.name = 'Cliente' AND NULLIF(trim(NEW.customer_name), '') IS NOT NULL
               THEN trim(NEW.customer_name)
               ELSE customers.name
             END,
      address = CASE
               WHEN NEW.delivery_type = 'delivery' AND NULLIF(trim(NEW.delivery_address), '') IS NOT NULL
               THEN trim(NEW.delivery_address)
               ELSE customers.address
             END;

  -- Case 2: order has a name but no phone
  ELSIF NEW.customer_name IS NOT NULL AND trim(NEW.customer_name) <> '' THEN
    SELECT id INTO v_existing_id
    FROM public.customers
    WHERE business_id = NEW.business_id
      AND lower(trim(name)) = lower(trim(NEW.customer_name))
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.customers
      SET
        total_orders = total_orders + 1,
        last_order_at = GREATEST(last_order_at, NEW.created_at),
        address = CASE
                   WHEN NEW.delivery_type = 'delivery' AND NULLIF(trim(NEW.delivery_address), '') IS NOT NULL
                   THEN trim(NEW.delivery_address)
                   ELSE address
                 END
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.customers (
        business_id,
        name,
        phone,
        total_orders,
        last_order_at,
        is_active,
        tags,
        address
      )
      VALUES (
        NEW.business_id,
        trim(NEW.customer_name),
        NULL,
        1,
        NEW.created_at,
        true,
        '{}',
        CASE
          WHEN NEW.delivery_type = 'delivery' THEN NULLIF(trim(COALESCE(NEW.delivery_address, '')), '')
          ELSE NULL
        END
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
