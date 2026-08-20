-- Fix: wa_conversations INSERT in auto_register_wa_contact must be an upsert
-- The unique index idx_wa_conversations_channel_unique (business_id, contact_id, channel)
-- was causing a UNIQUE VIOLATION when the same customer placed a second order,
-- rolling back the entire orders INSERT transaction silently.

CREATE OR REPLACE FUNCTION public.auto_register_wa_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact_id uuid;
  v_conv_id    uuid;
  v_summary    text;
BEGIN
  -- ── 1. Upsert wa_contact ───────────────────────────────────────────────────
  IF NEW.customer_phone IS NOT NULL AND trim(NEW.customer_phone) <> '' THEN
    INSERT INTO public.wa_contacts
      (business_id, phone, name, status, channel, last_interaction_at)
    VALUES (
      NEW.business_id,
      trim(NEW.customer_phone),
      COALESCE(NULLIF(trim(NEW.customer_name), ''), trim(NEW.customer_phone)),
      'new', 'whatsapp', NEW.created_at
    )
    ON CONFLICT (business_id, phone)
      WHERE phone IS NOT NULL AND channel = 'whatsapp'
    DO UPDATE SET
      last_interaction_at = GREATEST(wa_contacts.last_interaction_at, NEW.created_at),
      score               = wa_contacts.score + 1,
      name                = CASE
        WHEN wa_contacts.name = wa_contacts.phone
             AND NULLIF(trim(NEW.customer_name), '') IS NOT NULL
        THEN trim(NEW.customer_name)
        ELSE wa_contacts.name
      END
    RETURNING id INTO v_contact_id;

    -- RETURNING may be NULL on DO UPDATE in older PG builds — fall back
    IF v_contact_id IS NULL THEN
      SELECT id INTO v_contact_id
      FROM public.wa_contacts
      WHERE business_id = NEW.business_id
        AND phone       = trim(NEW.customer_phone)
        AND channel     = 'whatsapp';
    END IF;

  ELSIF NEW.customer_name IS NOT NULL AND trim(NEW.customer_name) <> '' THEN
    SELECT id INTO v_contact_id
    FROM public.wa_contacts
    WHERE business_id = NEW.business_id
      AND lower(trim(name)) = lower(trim(NEW.customer_name))
      AND channel = 'whatsapp'
    LIMIT 1;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.wa_contacts
        (business_id, name, phone, status, channel, last_interaction_at)
      VALUES
        (NEW.business_id, trim(NEW.customer_name), NULL, 'new', 'whatsapp', NEW.created_at)
      RETURNING id INTO v_contact_id;
    END IF;
  END IF;

  -- ── 2. Upsert wa_conversation + insert wa_message for this order ───────────
  IF v_contact_id IS NOT NULL THEN
    -- Build human-readable order summary
    v_summary := '🛒 Pedido #' || upper(left(NEW.id::text, 8));
    IF NEW.customer_name IS NOT NULL AND trim(NEW.customer_name) <> '' THEN
      v_summary := v_summary || ' — ' || trim(NEW.customer_name);
    END IF;
    v_summary := v_summary || ' | ' || COALESCE(NEW.delivery_type, 'local');
    IF NEW.notes IS NOT NULL AND trim(NEW.notes) <> '' THEN
      v_summary := v_summary || ': ' || trim(NEW.notes);
    END IF;
    IF NEW.total > 0 THEN
      v_summary := v_summary || ' | $' || to_char(NEW.total, 'FM999,999,999');
    END IF;

    -- UPSERT wa_conversation (was plain INSERT — caused UNIQUE VIOLATION on repeat orders)
    INSERT INTO public.wa_conversations
      (business_id, contact_id, status, needs_human, unread_count, last_message_at, channel)
    VALUES
      (NEW.business_id, v_contact_id, 'pending', true, 1, NEW.created_at, 'whatsapp')
    ON CONFLICT (business_id, contact_id, channel)
    DO UPDATE SET
      unread_count    = wa_conversations.unread_count + 1,
      last_message_at = GREATEST(wa_conversations.last_message_at, NEW.created_at),
      needs_human     = true,
      status          = CASE
        WHEN wa_conversations.status = 'resolved' THEN 'pending'
        ELSE wa_conversations.status
      END
    RETURNING id INTO v_conv_id;

    -- Fallback if RETURNING gives NULL on DO UPDATE
    IF v_conv_id IS NULL THEN
      SELECT id INTO v_conv_id
      FROM public.wa_conversations
      WHERE business_id = NEW.business_id
        AND contact_id  = v_contact_id
        AND channel     = 'whatsapp';
    END IF;

    INSERT INTO public.wa_messages
      (business_id, conversation_id, contact_id, direction, type, content, intent, sent_by_ai, channel)
    VALUES
      (NEW.business_id, v_conv_id, v_contact_id, 'inbound', 'text', v_summary, 'order', false, 'whatsapp');
  END IF;

  RETURN NEW;
END;
$$;
